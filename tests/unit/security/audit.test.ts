import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appendAudit, readAudit, type AuditInput } from "../../../lib/security/audit";
import { REDACTED } from "../../../lib/security/redact";
import { accountDirName, createFileStore, createMemoryStore } from "../../../lib/security/store";
import { B64URL_ALPHABET, HEX64, prng, randomString } from "../contracts/samples";

const ACCOUNT = "acct_audit";
const T0 = Date.parse("2026-10-22T08:00:00.000Z");
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const entry = (detail?: string): AuditInput => ({
  actor: "agent-approved-by-user",
  action: "set_env",
  target: { kind: "app", name: "shop" },
  paramsHash: HEX64,
  result: "ok",
  detail,
});

async function rawAuditText(dir: string): Promise<string> {
  const auditDir = path.join(dir, "v1", accountDirName(ACCOUNT), "audit");
  const files = await readdir(auditDir);
  return (await Promise.all(files.map((f) => readFile(path.join(auditDir, f), "utf8")))).join("");
}

describe("audit log", () => {
  it("never persists known secrets or pattern secrets (property loop over raw file bytes)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hamyar-audit-"));
    dirs.push(dir);
    const store = createFileStore(dir);
    const rand = prng(7);
    const secrets: string[] = [];
    for (let i = 0; i < 60; i++) {
      const secret = `${randomString(rand, B64URL_ALPHABET, 10, 30)}Aa1`;
      secrets.push(secret);
      const templates = [
        `env updated: DB_PASSWORD=${secret}`,
        `failed: postgres://app:${secret}@db:5432/x`,
        `value echoed ${secret} by mistake`,
        `{"key":"API_TOKEN","value":"${secret}"}`,
        `Authorization: Bearer ${secret}`,
      ];
      await appendAudit(store, ACCOUNT, entry(templates[i % templates.length]), { knownSecrets: [secret], now: T0 + i });
    }
    const text = await rawAuditText(dir);
    for (const s of secrets) expect(text.includes(s), s).toBe(false);
    expect(text).toContain(REDACTED);
  });

  it("redacts every field, not only detail", async () => {
    const store = createMemoryStore();
    const saved = await appendAudit(store, ACCOUNT, { ...entry("ok"), action: "domain.add", proposalId: "p_1" }, { knownSecrets: ["shop-secret-host"] });
    expect(saved.action).toBe("domain.add");
    const hidden = await appendAudit(store, ACCOUNT, { ...entry("ok"), target: { kind: "app", name: "shop-secret-host" } }, { knownSecrets: ["shop-secret-host"] });
    expect(hidden.target.name).toBe(REDACTED);
  });

  it("cannot be forged through newlines in detail (one JSON line per entry)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hamyar-audit-"));
    dirs.push(dir);
    const store = createFileStore(dir);
    const forged = `ok\n{"ts":"2026-01-01T00:00:00.000Z","actor":"system","action":"delete_app","target":{"kind":"app","name":"x"},"paramsHash":"${HEX64}","result":"ok"}`;
    await appendAudit(store, ACCOUNT, entry(forged), { now: T0 });
    const lines = (await rawAuditText(dir)).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const read = await readAudit(store, ACCOUNT);
    expect(read).toHaveLength(1);
    expect(read[0].action).toBe("set_env");
  });

  it("truncates long details after redaction and orders newest first", async () => {
    const store = createMemoryStore();
    const long = await appendAudit(store, ACCOUNT, entry(`password=${"s".repeat(10)} ${"x".repeat(5000)}`), { now: T0 });
    expect(long.detail?.length).toBeLessThanOrEqual(2000);
    expect(long.detail).toContain(`password=${REDACTED}`);
    for (let i = 1; i <= 5; i++) await appendAudit(store, ACCOUNT, entry(`n${i}`), { now: T0 + i });
    const read = await readAudit(store, ACCOUNT, { limit: 3 });
    expect(read.map((e) => e.detail)).toEqual(["n5", "n4", "n3"]);
    expect(read[0].ts).toBe(new Date(T0 + 5).toISOString());
  });

  it("rejects invalid entries", async () => {
    const store = createMemoryStore();
    await expect(appendAudit(store, ACCOUNT, { ...entry(), actor: "agent" as never })).rejects.toThrow();
    await expect(appendAudit(store, ACCOUNT, { ...entry(), paramsHash: "nothex" })).rejects.toThrow();
    await expect(appendAudit(store, ACCOUNT, { ...entry(), action: "DROP TABLE" })).rejects.toThrow();
    expect(await readAudit(store, ACCOUNT)).toEqual([]);
  });
});
