import { lstat, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AuditEntry } from "../../../lib/contracts/audit";
import type { CanvasLayout } from "../../../lib/contracts/layout";
import { createProposal, transition } from "../../../lib/security/state-machine";
import {
  StoreError,
  accountDirName,
  assertSafeId,
  createFileStore,
  createMemoryStore,
  getDefaultStore,
  type Store,
  type StoreLimits,
} from "../../../lib/security/store";
import { HEX64, SAMPLE_PARAMS } from "../contracts/samples";

const T0 = Date.parse("2026-10-22T08:00:00.000Z");
const ACCOUNT = "acct_store";
const tmpDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hamyar-store-"));
  tmpDirs.push(dir);
  return dir;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push(p);
    if (e.isDirectory()) out.push(...(await walk(p)));
  }
  return out;
}

const layout = (x: number, minute = 0): CanvasLayout => ({
  version: 1,
  nodes: { "app:shop": { x, y: 0 } },
  updatedAt: new Date(T0 + minute * 60_000).toISOString(),
});

const proposal = (minute = 0) =>
  createProposal(
    {
      accountId: ACCOUNT,
      params: SAMPLE_PARAMS.restart,
      source: "agent",
      rationaleFa: "r",
      evidenceIds: ["O1"],
      effectFa: "e",
      risksFa: [],
      verificationPlan: ["v"],
      stateFingerprint: HEX64,
    },
    T0 + minute * 60_000,
  );

const audit = (i: number): AuditEntry => ({
  ts: new Date(T0 + i * 1000).toISOString(),
  actor: "user",
  action: "restart",
  target: { kind: "app", name: "shop" },
  paramsHash: HEX64,
  result: "ok",
  detail: `entry ${i} ${"x".repeat(100)}`,
});

const TRAVERSAL_IDS: unknown[] = [
  "../x",
  "..",
  ".",
  "/etc/passwd",
  "a/b",
  "a\\b",
  "a\u0000b",
  "%2e%2e",
  "..%2f",
  "é",
  "",
  "a".repeat(65),
  " a",
  "a.json",
  "C:\\x",
  123,
  null,
  { toString: () => "x" },
];

type Factory = (limits?: Partial<StoreLimits>) => Promise<{ store: Store; dir?: string }>;
const factories: Array<[string, Factory]> = [
  ["memory", async (limits) => ({ store: createMemoryStore(limits) })],
  [
    "file",
    async (limits) => {
      const dir = await tmp();
      return { store: createFileStore(dir, limits), dir };
    },
  ],
];

describe.each(factories)("%s store", (kind, factory) => {
  it("rejects traversal and malformed ids on every operation", async () => {
    const { store, dir } = await factory();
    for (const id of TRAVERSAL_IDS) {
      const ops = [
        () => store.layouts.get(ACCOUNT, id as string),
        () => store.layouts.put(ACCOUNT, id as string, layout(1)),
        () => store.layouts.update(ACCOUNT, id as string, () => layout(1)),
        () => store.layouts.delete(ACCOUNT, id as string),
        () => store.proposals.get(ACCOUNT, id as string),
      ];
      for (const op of ops) await expect(op(), JSON.stringify(String(id))).rejects.toMatchObject({ code: "invalid_id" });
    }
    if (dir) expect(await walk(dir)).toEqual([]);
  });

  it("rejects invalid account ids and never uses the raw id as a path", async () => {
    const { store, dir } = await factory();
    for (const bad of ["", 42, null, "x".repeat(513)]) {
      await expect(store.layouts.get(bad as string, "main")).rejects.toMatchObject({ code: "invalid_account" });
    }
    await store.layouts.put("../../../../etc", "main", layout(1));
    expect(await store.layouts.get("../../../../etc", "main")).toEqual(layout(1));
    expect(await store.layouts.get("other", "main")).toBeUndefined();
    if (dir) {
      const files = await walk(dir);
      expect(files.every((f) => f.startsWith(dir + path.sep))).toBe(true);
      expect(files.some((f) => f.includes("etc"))).toBe(false);
      expect(files.some((f) => f.includes(accountDirName("../../../../etc")))).toBe(true);
    }
  });

  it("validates values on write and binds document ids", async () => {
    const { store } = await factory();
    const p = proposal();
    await expect(store.proposals.put(ACCOUNT, "p_other_id", p)).rejects.toMatchObject({ code: "invalid_value" });
    const aiDelete = { ...p, type: "delete_app", params: SAMPLE_PARAMS.delete_app, reversible: "no" } as unknown as typeof p;
    await expect(store.proposals.put(ACCOUNT, p.id, aiDelete)).rejects.toMatchObject({ code: "invalid_value" });
    await expect(store.layouts.put(ACCOUNT, "main", { version: 2 } as unknown as CanvasLayout)).rejects.toMatchObject({ code: "invalid_value" });
    await store.proposals.put(ACCOUNT, p.id, p);
    expect(await store.proposals.get(ACCOUNT, p.id)).toEqual(p);
    await expect(store.proposals.update(ACCOUNT, p.id, (cur) => (cur ? { ...cur, id: "p_swapped" } : cur))).rejects.toMatchObject({
      code: "invalid_value",
    });
    expect(await store.proposals.delete(ACCOUNT, p.id)).toBe(true);
    expect(await store.proposals.delete(ACCOUNT, p.id)).toBe(false);
  });

  it("serializes concurrent read-modify-write (no lost updates)", async () => {
    const { store } = await factory();
    await store.layouts.put(ACCOUNT, "main", layout(0));
    await Promise.all(
      Array.from({ length: 50 }, () =>
        store.layouts.update(ACCOUNT, "main", (cur) => (cur ? { ...cur, nodes: { "app:shop": { x: cur.nodes["app:shop"].x + 1, y: 0 } } } : cur)),
      ),
    );
    expect((await store.layouts.get(ACCOUNT, "main"))?.nodes["app:shop"].x).toBe(50);
  });

  it("keeps incident/layout counts bounded and refuses to evict live proposals", async () => {
    const { store } = await factory({ maxLayouts: 3, maxProposals: 2 });
    for (let i = 0; i < 6; i++) await store.layouts.put(ACCOUNT, `l${i}`, layout(i, i));
    const kept = await store.layouts.list(ACCOUNT);
    expect(kept.map((l) => l.nodes["app:shop"].x)).toEqual([5, 4, 3]);

    const p1 = proposal(1);
    const p2 = proposal(2);
    await store.proposals.put(ACCOUNT, p1.id, p1);
    await store.proposals.put(ACCOUNT, p2.id, p2);
    const p3 = proposal(3);
    await expect(store.proposals.put(ACCOUNT, p3.id, p3)).rejects.toMatchObject({ code: "full" });
    await store.proposals.put(ACCOUNT, p1.id, transition(p1, "rejected", T0 + 120_000));
    await store.proposals.put(ACCOUNT, p3.id, p3); // evicts the terminal one
    expect((await store.proposals.list(ACCOUNT)).map((p) => p.id).sort()).toEqual([p2.id, p3.id].sort());
  });

  it("nonces are one-time, expire, and fail closed when full", async () => {
    const { store } = await factory({ maxNonces: 3 });
    const n = (i: number) => `nonce_${String(i).padStart(16, "0")}`;
    expect(await store.nonces.consume(ACCOUNT, n(1), T0 + 1000, T0)).toBe(true);
    expect(await store.nonces.consume(ACCOUNT, n(1), T0 + 1000, T0)).toBe(false);
    expect(await store.nonces.consume(ACCOUNT, n(9), T0, T0)).toBe(false); // already expired
    expect(await store.nonces.consume(ACCOUNT, n(2), T0 + 1000, T0)).toBe(true);
    expect(await store.nonces.consume(ACCOUNT, n(3), T0 + 1000, T0)).toBe(true);
    expect(await store.nonces.consume(ACCOUNT, n(4), T0 + 1000, T0)).toBe(false); // table full
    expect(await store.nonces.consume(ACCOUNT, n(4), T0 + 5000, T0 + 2000)).toBe(true); // old ones purged
    expect(await store.nonces.consume(ACCOUNT, n(1), T0 + 5000, T0 + 2000)).toBe(true); // reuse only after expiry
    const results = await Promise.all(Array.from({ length: 20 }, () => store.nonces.consume("acct_race", n(7), T0 + 1000, T0)));
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(store.nonces.consume(ACCOUNT, "short", T0 + 1000, T0)).rejects.toMatchObject({ code: "invalid_id" });
    await expect(store.nonces.consume(ACCOUNT, "../../../../etc/passwd_xx", T0 + 1000, T0)).rejects.toMatchObject({ code: "invalid_id" });
  });

  it("rotates the audit log and reads newest first", async () => {
    const { store, dir } = await factory({ auditRotateBytes: 2000, auditKeepRotated: 2 });
    for (let i = 0; i < 60; i++) await store.audit.append(ACCOUNT, audit(i));
    const read = await store.audit.read(ACCOUNT, { limit: 5 });
    expect(read.map((e) => e.detail?.split(" ")[1])).toEqual(["59", "58", "57", "56", "55"]);
    expect((await store.audit.read(ACCOUNT, { limit: 1000 })).length).toBeLessThan(60);
    await expect(store.audit.append(ACCOUNT, { ...audit(0), detail: "x".repeat(5000) })).rejects.toMatchObject({ code: "invalid_value" });
    await expect(store.audit.append(ACCOUNT, { ...audit(0), actor: "root" } as unknown as AuditEntry)).rejects.toMatchObject({
      code: "invalid_value",
    });
    if (dir) {
      const auditDir = path.join(dir, "v1", accountDirName(ACCOUNT), "audit");
      expect((await readdir(auditDir)).sort()).toEqual(["audit.1.jsonl", "audit.2.jsonl", "audit.jsonl"]);
      for (const f of await readdir(auditDir)) expect((await stat(path.join(auditDir, f))).size).toBeLessThanOrEqual(2000);
    }
  });

  if (kind === "file") {
    it("writes atomically with private permissions and leaves no temp files", async () => {
      const { store, dir } = await factory();
      await Promise.all(Array.from({ length: 30 }, (_, i) => store.layouts.put(ACCOUNT, `l${i % 3}`, layout(i))));
      const files = await walk(dir as string);
      expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
      for (const f of files) {
        const st = await lstat(f);
        expect(st.mode & 0o077, f).toBe(0);
      }
    });

    it("fails closed on corrupt or symlinked proposals, tolerates corrupt layouts", async () => {
      const { store, dir } = await factory();
      const p = proposal();
      await store.proposals.put(ACCOUNT, p.id, p);
      const acctDir = path.join(dir as string, "v1", accountDirName(ACCOUNT));
      await writeFile(path.join(acctDir, "proposals", `${p.id}.json`), "{not json");
      await expect(store.proposals.get(ACCOUNT, p.id)).rejects.toBeInstanceOf(StoreError);
      expect(await store.proposals.list(ACCOUNT)).toEqual([]);

      const secretFile = path.join(dir as string, "outside.json");
      await writeFile(secretFile, JSON.stringify(p));
      await symlink(secretFile, path.join(acctDir, "proposals", "p_link.json"));
      await expect(store.proposals.get(ACCOUNT, "p_link")).rejects.toMatchObject({ code: "corrupt" });

      await mkdir(path.join(acctDir, "layouts"), { recursive: true });
      await writeFile(path.join(acctDir, "layouts", "main.json"), '{"version": 99}');
      expect(await store.layouts.get(ACCOUNT, "main")).toBeUndefined();

      await writeFile(path.join(acctDir, "nonces.json"), "garbage");
      await expect(store.nonces.consume(ACCOUNT, "nonce_000000000000001", T0 + 1000, T0)).rejects.toMatchObject({ code: "corrupt" });
    });
  }
});

describe("store helpers", () => {
  it("assertSafeId accepts only the safe charset", () => {
    expect(() => assertSafeId("p_ok-1")).not.toThrow();
    for (const id of TRAVERSAL_IDS) expect(() => assertSafeId(id)).toThrow(StoreError);
  });

  it("account directory names are hashes", () => {
    expect(accountDirName("acct")).toMatch(/^[a-f0-9]{40}$/);
    expect(accountDirName("acct")).not.toBe(accountDirName("acct2"));
  });

  it("getDefaultStore is a process-wide singleton", () => {
    expect(getDefaultStore()).toBe(getDefaultStore());
  });
});
