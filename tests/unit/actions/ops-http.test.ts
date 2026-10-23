// POST /api/ops (human-initiated) and GET /api/audit. Synthetic data only.
import { describe, expect, it } from "vitest";
import { handleAudit } from "../../../lib/actions/http/incidents";
import { handleOps } from "../../../lib/actions/http/ops";
import { body, ctxFor, setup } from "./helpers";

type ErrBody = { error: { code: string; message: string; field?: string; details?: Record<string, unknown> } };

describe("guards", () => {
  it.each([
    ["foreign Origin", { origin: "https://evil.example" }],
    ["cross-site fetch metadata", { "sec-fetch-site": "cross-site" }],
    ["same-site sibling (e.g. another *.liara.run app)", { "sec-fetch-site": "same-site" }],
  ])("%s -> 403 before anything runs", async (_n, headers) => {
    const env = setup();
    env.liara.addApp("shop");
    const res = await handleOps(ctxFor(env, { body: { params: { type: "restart", app: "shop" } }, headers }), env.deps);
    expect(res.status).toBe(403);
    expect((await body<ErrBody>(res)).error.code).toBe("forbidden_origin");
    expect(env.liara.calls).toHaveLength(0);
  });

  it("no Origin and no fetch metadata -> 403 (strict check on top of api())", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const ctx = ctxFor(env, { body: { params: { type: "restart", app: "shop" } } });
    const req = new Request(ctx.request.url, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ params: { type: "restart", app: "shop" } }) });
    expect((await handleOps({ ...ctx, request: req }, env.deps)).status).toBe(403);
  });

  it("rate limits per account (20/min)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await handleOps(ctxFor(env, { body: { params: { type: "restart", app: "shop" } } }), env.deps)).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("strict bodies: unknown fields, wrong content type, oversize, bad JSON", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const extra = await handleOps(ctxFor(env, { body: { params: { type: "restart", app: "shop" }, accountId: "acct_other" } }), env.deps);
    expect(extra.status).toBe(400);
    const badParams = await handleOps(ctxFor(env, { body: { params: { type: "restart", app: "Shop!", value: "s3cret" } } }), env.deps);
    expect(badParams.status).toBe(400);
    expect(JSON.stringify(await body(badParams))).not.toContain("s3cret");
    expect((await handleOps(ctxFor(env, { rawBody: "params=1", headers: { "content-type": "application/x-www-form-urlencoded" } }), env.deps)).status).toBe(415);
    expect((await handleOps(ctxFor(env, { rawBody: "x".repeat(1024 * 1024 + 1) }), env.deps)).status).toBe(413);
    expect((await handleOps(ctxFor(env, { rawBody: "{not json" }), env.deps)).status).toBe(400);
    expect(env.liara.calls).toHaveLength(0);
  });
});

describe("typed names and tier-3 deletes (human only, here only)", () => {
  it("delete_app requires the exact name; success returns the documented shape with an auditId", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const missing = await handleOps(ctxFor(env, { body: { params: { type: "delete_app", app: "shop" } } }), env.deps);
    expect(missing.status).toBe(400);
    expect((await body<ErrBody>(missing)).error.code).toBe("typed_name_mismatch");
    const wrong = await handleOps(ctxFor(env, { body: { params: { type: "delete_app", app: "shop" }, typedName: "shop2" } }), env.deps);
    expect(wrong.status).toBe(400);
    expect(env.liara.calls.some((c) => c.method === "DELETE")).toBe(false);

    const ok = await handleOps(ctxFor(env, { body: { params: { type: "delete_app", app: "shop" }, typedName: "shop" } }), env.deps);
    expect(ok.status).toBe(200);
    const res = await body<{ ok: true; type: string; target: unknown; summary: unknown; auditId: string }>(ok);
    expect(res).toMatchObject({ ok: true, type: "delete_app", target: { kind: "app", name: "shop" }, summary: { deleted: "app", name: "shop" } });
    expect(res.auditId).toMatch(/^aud_[a-f0-9]{24}$/);
    const audit = await body<{ entries: Array<{ id: string; result: string; action: string }> }>(await handleAudit(ctxFor(env, { method: "GET" }), env.deps));
    expect(audit.entries[0]).toMatchObject({ id: res.auditId, result: "ok", action: "delete_app" });
    expect(audit.entries.filter((e) => e.result === "denied")).toHaveLength(2);
  });

  it("delete_db: typed name is the hostname, resolved to the Liara ref server-side", async () => {
    const env = setup();
    env.liara.addDb("shop-db");
    const res = await handleOps(ctxFor(env, { body: { params: { type: "delete_db", db: "shop-db" }, typedName: "shop-db" } }), env.deps);
    expect(res.status).toBe(200);
    expect(env.liara.calls.some((c) => c.method === "DELETE" && c.path === "/v1/databases/db_shop-db")).toBe(true);
  });

  it("delete_domain uses the domain name, delete_disk the disk name", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.domains.push({ _id: "d1", name: "shop.example.ir", project: "shop" });
    env.liara.disks.set("shop", [{ name: "uploads" }]);
    expect((await handleOps(ctxFor(env, { body: { params: { type: "delete_domain", domain: "shop.example.ir" }, typedName: "shop" } }), env.deps)).status).toBe(400);
    expect((await handleOps(ctxFor(env, { body: { params: { type: "delete_domain", domain: "shop.example.ir" }, typedName: "shop.example.ir" } }), env.deps)).status).toBe(200);
    expect((await handleOps(ctxFor(env, { body: { params: { type: "delete_disk", app: "shop", disk: "uploads" }, typedName: "shop" } }), env.deps)).status).toBe(400);
    expect((await handleOps(ctxFor(env, { body: { params: { type: "delete_disk", app: "shop", disk: "uploads" }, typedName: "uploads" } }), env.deps)).status).toBe(200);
  });

  it("billed creations need the typed name; tier-1 ops do not", async () => {
    const env = setup();
    env.liara.addApp("shop");
    expect((await handleOps(ctxFor(env, { body: { params: { type: "create_network", name: "net2" } } }), env.deps)).status).toBe(400);
    expect((await handleOps(ctxFor(env, { body: { params: { type: "create_network", name: "net2" }, typedName: "net2" } }), env.deps)).status).toBe(200);
    expect((await handleOps(ctxFor(env, { body: { params: { type: "restart", app: "shop" } } }), env.deps)).status).toBe(200);
  });

  it("deploy_plan is refused here (it runs through the proposal flow with streamed progress)", async () => {
    const env = setup();
    const res = await handleOps(
      ctxFor(env, {
        body: {
          params: { type: "deploy_plan", plan: { app: "shop", steps: [{ id: "S1", kind: "domain_guidance" }], totals: { perHourToman: 0, perMonthToman: 0 } } },
          typedName: "shop",
        },
      }),
      env.deps,
    );
    expect(res.status).toBe(400);
    expect((await body<ErrBody>(res)).error.code).toBe("use_proposal_flow");
  });

  it("two members of the same team are serialized on one resource", async () => {
    const env = setup({ teamId: "team-x" });
    env.liara.addApp("shop");
    env.liara.fault("POST /v1/projects/shop/actions/restart", { hang: true });
    const first = ctxFor(env, { body: { params: { type: "restart", app: "shop" } } });
    first.liara = env.liara.client({ teamId: "team-x", timeoutMs: 150 });
    const teammate = ctxFor({ ...env, accountId: "acct_teammate_2" }, { body: { params: { type: "restart", app: "shop" } } });
    const [a, b] = await Promise.all([handleOps(first, env.deps), handleOps(teammate, env.deps)]);
    expect([a.status, b.status].sort()).toEqual([409, 504]);
  });

  it("one mutation per target at a time", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("POST /v1/projects/shop/actions/restart", { hang: true });
    const slow = ctxFor(env, { body: { params: { type: "restart", app: "shop" } } });
    slow.liara = env.liara.client({ timeoutMs: 150 });
    const [a, b] = await Promise.all([handleOps(slow, env.deps), handleOps(ctxFor(env, { body: { params: { type: "restart", app: "shop" } } }), env.deps)]);
    expect([a.status, b.status].sort()).toEqual([409, 504]);
    expect(env.liara.calls.filter((c) => c.path === "/v1/projects/shop/actions/restart")).toHaveLength(1);
  });
});
