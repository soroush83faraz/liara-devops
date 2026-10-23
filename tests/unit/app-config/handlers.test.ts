// All inputs are SYNTHETIC (made up for these tests); nothing here was recorded from Liara.
// Route logic is exercised through the exported `handle…` functions with a real Liara client over a fake fetch.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ApiContext } from "../../../lib/server/liara";
import { toErrorResponse } from "../../../lib/server/liara";
import {
  handleAddDomain,
  handleCheckDomain,
  handleCreateDisk,
  handleDomainRedirect,
  handleDomainSsl,
  handleGetSettings,
  handleListDisks,
  handleListDomains,
  handleListEnvs,
  handleResizeDisk,
  handleRevealEnv,
  handleToggle,
} from "../../../lib/service/app-config/handlers";
import { routes, type Call } from "../liara/helpers";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "../../fixtures/liara", `${name}.synthetic.json`), "utf8")) as Record<string, unknown>;
const SECRET = "SYNTH-SECRET";

let dataDir: string;
beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "app-config-test-"));
  process.env.DATA_DIR = dataDir;
});

function ctxFor(table: Parameters<typeof routes>[0], body?: unknown, accountId = `acct-${Math.random().toString(36).slice(2)}`) {
  const { client, calls } = routes(table);
  const request = new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx: ApiContext = { session: { token: "tok", accountId }, liara: client, request };
  return { ctx, calls };
}

const app = fixture("app-detail");
const APP_ROUTE = { "GET /v1/projects/demo-shop": { json: app } };
const mutating = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

async function run(p: Promise<Response>): Promise<Response> {
  try {
    return await p;
  } catch (e) {
    return toErrorResponse(e); // what api() does
  }
}

describe("envs", () => {
  it("lists keys only: no value appears anywhere in the response", async () => {
    const { ctx } = ctxFor(APP_ROUTE);
    const res = await handleListEnvs(ctx, { name: "demo-shop" });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("production");
    const body = JSON.parse(text) as { envs: Array<Record<string, unknown>> };
    expect(body.envs.length).toBeGreaterThan(1);
    for (const e of body.envs) {
      expect(Object.keys(e).sort()).toEqual(expect.arrayContaining(["key", "masked", "encrypted"]));
      expect(e).not.toHaveProperty("value");
      expect(e.masked).toBe(true);
    }
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an invalid app name", async () => {
    const { ctx } = ctxFor(APP_ROUTE);
    expect((await handleListEnvs(ctx, { name: "../x" })).status).toBe(400);
  });

  it("reveal returns exactly one value, audited without it", async () => {
    const { ctx } = ctxFor(APP_ROUTE, { key: "DATABASE_URL" });
    const res = await handleRevealEnv(ctx, { name: "demo-shop" });
    const body = (await res.json()) as { ok: boolean; value: string; action: string };
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: "env.reveal" });
    expect(body.value).toContain(SECRET);
    // The audit file store must not contain the value.
    const dump = readdirSync(dataDir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".json") || f.endsWith(".jsonl"))
      .map((f) => readFileSync(join(dataDir, f), "utf8"))
      .join("\n");
    expect(dump).toContain("env.reveal");
    expect(dump).not.toContain(SECRET);
  });

  it("reveal of a missing key is a 404 and rate limit kicks in after 10 per minute", async () => {
    const acct = "acct-reveal-limit";
    const { ctx } = ctxFor(APP_ROUTE, { key: "NOPE" }, acct);
    expect((await run(handleRevealEnv(ctx, { name: "demo-shop" }))).status).toBe(404);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const c = ctxFor(APP_ROUTE, { key: "NODE_ENV" }, acct);
      last = (await run(handleRevealEnv(c.ctx, { name: "demo-shop" }))).status;
    }
    expect(last).toBe(429);
  });

  it("reveal refuses malformed bodies and keys", async () => {
    for (const body of [{}, { key: "A B" }, { key: "A", extra: 1 }]) {
      const { ctx } = ctxFor(APP_ROUTE, body);
      expect((await handleRevealEnv(ctx, { name: "demo-shop" })).status).toBe(400);
    }
  });
});

describe("domains", () => {
  const domains = fixture("domains");
  const check = fixture("domain-check");

  it("lists domains with records", async () => {
    const { ctx } = ctxFor({ "GET /v1/domains": { json: domains } });
    const body = (await (await handleListDomains(ctx, { name: "demo-shop" })).json()) as { domains: Array<{ name: string; records: Array<{ kind: string; value: string | null }> }> };
    expect(body.domains[0].name).toBe("shop.example.ir");
    expect(body.domains[0].records.find((r) => r.kind === "cname")?.value).toBe("demo-shop.liara.run");
    expect(body.domains[0].records.find((r) => r.kind === "verification")?.value).toBeNull();
  });

  it("add: normalizes, calls Liara once, then reads the records via check", async () => {
    const { ctx, calls } = ctxFor(
      { "POST /v1/domains": { json: { domain: { _id: "d1" } } }, "GET /v1/domains/d1/check": { json: check } },
      { name: "https://Shop.Example.IR/" },
    );
    const res = await handleAddDomain(ctx, { name: "demo-shop" });
    const body = (await res.json()) as { ok: boolean; action: string; domain?: { records: Array<{ value: string | null }> } };
    expect(res.status).toBe(200);
    expect(body.action).toBe("domain.add");
    expect(body.domain?.records.map((r) => r.value)).toContain("liara-verify-synthetic-123");
    expect(mutating(calls)).toHaveLength(1);
    expect(mutating(calls)[0].body).toEqual({ name: "shop.example.ir", project: "demo-shop", type: "PROJECT" });
  });

  it("add: restricted TLD and wildcard are refused before any Liara call", async () => {
    for (const name of ["x.tk", "*.example.com", ""]) {
      const { ctx, calls } = ctxFor({}, { name: name || " " });
      const res = await handleAddDomain(ctx, { name: "demo-shop" });
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    }
  });

  it("add still succeeds when the follow-up check fails (records fetched later)", async () => {
    const { ctx } = ctxFor({ "POST /v1/domains": { json: { domain: { _id: "d9" } } } }, { name: "example.com" });
    const res = await handleAddDomain(ctx, { name: "demo-shop" });
    const body = (await res.json()) as { ok: boolean; id: string; domain?: unknown };
    expect(body).toMatchObject({ ok: true, id: "d9" });
    expect(body.domain).toBeUndefined();
  });

  it("check returns Liara's state and a timestamp; invalid ids are 400", async () => {
    const { ctx } = ctxFor({ "GET /v1/domains/d1/check": { json: check } });
    const body = (await (await handleCheckDomain(ctx, { id: "d1" })).json()) as { checkedAt: string; domain: { status: string } };
    expect(body.domain.status).toBe("PENDING");
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    expect((await handleCheckDomain(ctx, { id: "../d1" })).status).toBe(400);
  });

  it("ssl: provision sends the name; disable needs the typed name and calls the id endpoint", async () => {
    const table = {
      "GET /v1/domains/d1/check": { json: check },
      "POST /v1/domains/provision-ssl-certs": { json: { code: "ok" } },
      "POST /v1/domains/d1/ssl/disable": { status: 204 },
    };
    const on = ctxFor(table, { enable: true });
    const r1 = await handleDomainSsl(on.ctx, { id: "d1" });
    expect(r1.status).toBe(200);
    expect(mutating(on.calls)[0].body).toEqual({ domain: "shop.example.ir" });

    const noName = ctxFor(table, { enable: false });
    const r2 = await handleDomainSsl(noName.ctx, { id: "d1" });
    expect(r2.status).toBe(400);
    expect((await r2.json()) as { error: { code: string } }).toMatchObject({ error: { code: "typed_name_mismatch" } });
    expect(mutating(noName.calls)).toHaveLength(0);

    const off = ctxFor(table, { enable: false, typedName: "shop.example.ir" });
    expect((await handleDomainSsl(off.ctx, { id: "d1" })).status).toBe(200);
    expect(mutating(off.calls)[0].path).toBe("/v1/domains/d1/ssl/disable");
  });

  it("redirect: validates target, forwards status", async () => {
    const table = { "GET /v1/domains/d1/check": { json: check }, "POST /v1/domains/d1/set-redirect": { json: {} } };
    const ok = ctxFor(table, { redirectTo: "www.example.com", redirectStatus: 302 });
    expect((await handleDomainRedirect(ok.ctx, { id: "d1" })).status).toBe(200);
    expect(mutating(ok.calls)[0].body).toEqual({ redirectStatus: 302, redirectTo: "www.example.com" });

    const self = ctxFor(table, { redirectTo: "shop.example.ir", redirectStatus: 301 });
    expect((await handleDomainRedirect(self.ctx, { id: "d1" })).status).toBe(400);
    const badStatus = ctxFor(table, { redirectTo: "www.example.com", redirectStatus: 307 });
    expect((await handleDomainRedirect(badStatus.ctx, { id: "d1" })).status).toBe(400);
  });
});

describe("disks", () => {
  const disks = fixture("disks");
  const table = {
    // live 2026-10-23: listing by NAME is a 500, by project _id ("a1" in the app fixture) it works; create works by name
    "GET /v1/projects/demo-shop/disks": { status: 500, json: { error: "Internal Server Error" } },
    "GET /v1/projects/a1/disks": { json: disks },
    "GET /v1/projects/demo-shop": { json: app },
    "POST /v1/projects/demo-shop/disks": { json: {} },
    "POST /v1/projects/a1/disks/data/resize": { json: {} },
  };

  it("lists disks with mounts and the reserved space", async () => {
    const { ctx } = ctxFor(table);
    const body = (await (await handleListDisks(ctx, { name: "demo-shop" })).json()) as { disks: Array<Record<string, unknown>>; reservedDiskSpace: number };
    expect(body.disks[0]).toMatchObject({ name: "data", sizeGb: 1, mountedTo: "/data" });
    expect(body.reservedDiskSpace).toBe(1);
  });

  it("lists through the project _id, never the name route (which answers 500 live)", async () => {
    const { ctx, calls } = ctxFor(table);
    await handleListDisks(ctx, { name: "demo-shop" });
    const paths = calls.map((c) => c.path);
    expect(paths).toContain("/v1/projects/a1/disks");
    expect(paths).not.toContain("/v1/projects/demo-shop/disks");
  });

  it("a failing disk list is an error response, not an empty list", async () => {
    const { ctx } = ctxFor({ "GET /v1/projects/demo-shop": { json: app }, "GET /v1/projects/a1/disks": { status: 500, json: { error: "Internal Server Error" } } });
    expect((await run(handleListDisks(ctx, { name: "demo-shop" }))).status).toBeGreaterThanOrEqual(500);
  });

  it("disk.create requires the typed name (runUserOp) and sends nothing to Liara without it", async () => {
    const missing = ctxFor(table, { name: "uploads", sizeGb: 2 });
    const r = await handleCreateDisk(missing.ctx, { name: "demo-shop" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("typed_name_mismatch");
    expect(mutating(missing.calls)).toHaveLength(0);

    const wrong = ctxFor(table, { name: "uploads", sizeGb: 2, typedName: "demo-shop" });
    expect((await handleCreateDisk(wrong.ctx, { name: "demo-shop" })).status).toBe(400);
    expect(mutating(wrong.calls)).toHaveLength(0);

    const good = ctxFor(table, { name: "uploads", sizeGb: 2, typedName: "uploads" });
    const ok = await handleCreateDisk(good.ctx, { name: "demo-shop" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { action: string }).action).toBe("disk.create");
    expect(mutating(good.calls)[0]).toMatchObject({ path: "/v1/projects/demo-shop/disks", body: { name: "uploads", size: "2" } });
  });

  it("create validates name and size", async () => {
    for (const body of [{ name: "Bad_Name", sizeGb: 1, typedName: "Bad_Name" }, { name: "ok", sizeGb: 0, typedName: "ok" }, { name: "ok", sizeGb: 1.5, typedName: "ok" }]) {
      const { ctx } = ctxFor(table, body);
      expect((await handleCreateDisk(ctx, { name: "demo-shop" })).status).toBe(400);
    }
  });

  it("resize grows only and needs the typed disk name", async () => {
    const shrink = ctxFor(table, { sizeGb: 1, typedName: "data" });
    const r0 = await handleResizeDisk(shrink.ctx, { name: "demo-shop", disk: "data" });
    expect(r0.status).toBe(400);
    expect(((await r0.json()) as { error: { code: string } }).error.code).toBe("not_larger");

    const noName = ctxFor(table, { sizeGb: 5 });
    expect((await handleResizeDisk(noName.ctx, { name: "demo-shop", disk: "data" })).status).toBe(400);
    expect(mutating(noName.calls)).toHaveLength(0);

    const ok = ctxFor(table, { sizeGb: 5, typedName: "data" });
    expect((await handleResizeDisk(ok.ctx, { name: "demo-shop", disk: "data" })).status).toBe(200);
    expect(mutating(ok.calls)[0]).toMatchObject({ path: "/v1/projects/a1/disks/data/resize", body: { size: "5" } });

    const missing = ctxFor(table, { sizeGb: 5, typedName: "ghost" });
    expect((await run(handleResizeDisk(missing.ctx, { name: "demo-shop", disk: "ghost" }))).status).toBe(404);
  });
});

describe("settings", () => {
  const me = fixture("me");
  const releases = fixture("releases");
  const table = {
    "GET /v1/projects/demo-shop": { json: app },
    "GET /v1/me": { json: me },
    "GET /v1/projects/demo-shop/releases": { json: releases },
  };

  it("returns state, plans (with the current plan kept) and no env values", async () => {
    const { ctx } = ctxFor(table);
    const res = await handleGetSettings(ctx, { name: "demo-shop" });
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text) as { planID: string; scale: number; plans: { unavailable: boolean; data?: Array<{ id: string }> }; fixedIPStatus: string; nodeIp: string };
    expect(body).toMatchObject({ planID: "iran-g2-small", scale: 1, fixedIPStatus: "DISABLED", nodeIp: "203.0.113.10" });
    expect(body.plans.unavailable).toBe(false);
    expect(body.plans.data?.some((p) => p.id === "iran-g2-small")).toBe(true);
    expect(Object.keys(body)).not.toContain("envs");
  });

  it("plans degrade honestly when /v1/me fails", async () => {
    const { ctx } = ctxFor({ ...table, "GET /v1/me": { status: 500, json: {} } });
    const body = (await (await handleGetSettings(ctx, { name: "demo-shop" })).json()) as { plans: { unavailable: boolean } };
    expect(body.plans).toEqual({ unavailable: true });
  });

  it("toggle: action code per toggle; fixed-ip needs the typed app name", async () => {
    const t1 = ctxFor({ "POST /v1/projects/demo-shop/zero-downtime/enable": { json: {} } }, { toggle: "zero-downtime", enabled: true });
    const r1 = await handleToggle(t1.ctx, { name: "demo-shop" });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { action: string }).action).toBe("toggle.zero-downtime");

    const t2 = ctxFor({ "POST /v1/projects/demo-shop/fixed-ip/enable": { json: { IP: "203.0.113.50" } } }, { toggle: "fixed-ip", enabled: true });
    expect((await handleToggle(t2.ctx, { name: "demo-shop" })).status).toBe(400);
    expect(mutating(t2.calls)).toHaveLength(0);
    const t3 = ctxFor({ "POST /v1/projects/demo-shop/fixed-ip/enable": { json: { IP: "203.0.113.50" } } }, { toggle: "fixed-ip", enabled: true, typedName: "demo-shop" });
    const r3 = await handleToggle(t3.ctx, { name: "demo-shop" });
    expect(((await r3.json()) as { ip: string }).ip).toBe("203.0.113.50");

    const bad = ctxFor({}, { toggle: "nope", enabled: true });
    expect((await handleToggle(bad.ctx, { name: "demo-shop" })).status).toBe(400);
  });

  it("maps a Liara 409 to the Persian conflict message", async () => {
    const { ctx } = ctxFor({ "POST /v1/projects/demo-shop/read-only/enable": { status: 409, json: { message: "busy" } } }, { toggle: "read-only", enabled: true });
    const res = await handleToggle(ctx, { name: "demo-shop" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("عملیات دیگری در حال انجام است. کمی بعد دوباره تلاش کنید.");
  });
});
