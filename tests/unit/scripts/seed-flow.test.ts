import { describe, expect, it } from "vitest";
import { runDemoCommand } from "../../../scripts/lib/demo-cli";
import { collectIo, makeFake } from "./fake-liara";

const TOKEN = "liara-token-ABCDEF1234567890";
const SECRET = "very-secret-session-value-9f8e7d";
const watch = { queueIntervalMs: 1, logIntervalMs: 1, timeoutMs: 5000 };
const base = { LIARA_API_TOKEN: TOKEN };
const args = (scenario: string, ...rest: string[]) => ["--scenario", scenario, "--app", "broken-shop", ...rest];

describe("seed:demo / reset:demo", () => {
  it("dry-run is the default and makes no network call, even with a token", async () => {
    const fake = makeFake();
    const c = collectIo();
    const code = await runDemoCommand("seed", args("missing-secret"), { env: { ...base }, io: c.io, fetchImpl: fake.fetchImpl, watch });
    expect(code).toBe(0);
    // with a token the dry run may do read-only lookups, but never a mutation
    expect(fake.state.calls.every((x) => x.startsWith("GET "))).toBe(true);
    expect(c.text()).toContain("DRY RUN");
    expect(c.text()).toContain("ensure env SESSION_SECRET is UNSET");
    expect(c.text()).not.toContain(TOKEN);
  });

  it("dry-run works offline without any token (no fetch at all)", async () => {
    const fake = makeFake();
    const c = collectIo();
    const code = await runDemoCommand("seed", args("missing-secret", "--create", "--plan", "iran-g2-small"), { env: {}, io: c.io, fetchImpl: fake.fetchImpl });
    expect(code).toBe(0);
    expect(fake.state.calls).toEqual([]);
    expect(c.text()).toContain("offline");
    expect(c.text()).toContain("would be REFUSED"); // --create without ALLOW_BILLED_LIVE_TESTS
  });

  it("--yes without a token is refused (exit 2) before any call", async () => {
    const fake = makeFake();
    const c = collectIo();
    expect(await runDemoCommand("seed", args("healthy", "--yes"), { env: {}, io: c.io, fetchImpl: fake.fetchImpl })).toBe(2);
    expect(fake.state.calls).toEqual([]);
  });

  it("usage errors exit 1: unknown scenario, bad app name, missing flags, --plan without --create, --create without --plan", async () => {
    const run = (a: string[]) => runDemoCommand("seed", a, { env: {}, io: collectIo().io });
    expect(await run(["--scenario", "nope", "--app", "broken-shop"])).toBe(1);
    expect(await run(["--scenario", "healthy", "--app", "Bad_Name"])).toBe(1);
    expect(await run(["--scenario", "healthy"])).toBe(1);
    expect(await run(["--app", "broken-shop"])).toBe(1);
    expect(await run(args("healthy", "--plan", "iran-g2-small"))).toBe(1);
    expect(await run(args("healthy", "--create"))).toBe(1);
    expect(await run(args("healthy", "--bogus"))).toBe(1);
  });

  it("--create without ALLOW_BILLED_LIVE_TESTS=1 is refused (exit 2) with no call at all", async () => {
    const fake = makeFake({ exists: false });
    const c = collectIo();
    const code = await runDemoCommand("seed", args("healthy", "--create", "--plan", "iran-g2-small", "--yes"), { env: { ...base }, io: c.io, fetchImpl: fake.fetchImpl, watch });
    expect(code).toBe(2);
    expect(fake.state.calls).toEqual([]);
  });

  it("missing app without --create is refused (exit 2) and never creates anything", async () => {
    const fake = makeFake({ exists: false });
    const c = collectIo();
    expect(await runDemoCommand("seed", args("healthy", "--yes"), { env: { ...base }, io: c.io, fetchImpl: fake.fetchImpl, watch })).toBe(2);
    expect(fake.state.calls).toEqual(["GET /v1/projects/broken-shop"]);
    expect(c.text()).toContain("--create");
  });

  it("existing app, missing-secret: unsets SESSION_SECRET via the full-list merge, deploys, watches; no billed call", async () => {
    const fake = makeFake({ envs: [{ key: "NODE_ENV", value: "production" }, { key: "SESSION_SECRET", value: SECRET }] });
    const c = collectIo();
    const code = await runDemoCommand("seed", args("missing-secret", "--yes"), { env: { ...base }, io: c.io, fetchImpl: fake.fetchImpl, watch });
    expect(code).toBe(0);

    const calls = fake.state.calls;
    expect(calls).not.toContain("POST /v1/projects"); // nothing billed
    const order = ["POST /v1/projects/update-envs", "POST /v2/projects/broken-shop/sources", "POST /v2/projects/broken-shop/releases", "GET /v1/releases/rel1"];
    const idx = order.map((x) => calls.indexOf(x));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);

    // full list is sent: the untouched variable stays, only SESSION_SECRET is removed
    const envBody = fake.state.bodies.find((b) => b.call === "POST /v1/projects/update-envs")!.body as { variables: Array<{ key: string }> };
    expect(envBody.variables.map((v) => v.key)).toEqual(["NODE_ENV"]);
    const releaseBody = fake.state.bodies.find((b) => b.call === "POST /v2/projects/broken-shop/releases")!.body as Record<string, unknown>;
    expect(releaseBody).toMatchObject({ sourceID: "src1", port: 3000, type: "node" });

    const text = c.text();
    expect(text).toContain("final release state: READY");
    expect(text).toContain("url: https://broken-shop.liara.run (verified live 2026-10-23)");
    expect(text).not.toContain("unverified");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("production");
  });

  it("does not touch env (no restart) when the scenario's env state already holds", async () => {
    const fake = makeFake({ envs: [{ key: "NODE_ENV", value: "production" }] });
    const c = collectIo();
    expect(await runDemoCommand("reset", args("missing-secret", "--yes"), { env: { ...base }, io: c.io, fetchImpl: fake.fetchImpl, watch })).toBe(0);
    expect(fake.state.calls).not.toContain("POST /v1/projects/update-envs");
    expect(fake.state.calls).toContain("POST /v2/projects/broken-shop/releases");
  });

  it("db-unreachable: sets DB_HOST to an unreachable value, keeps other variables, never prints the value", async () => {
    const fake = makeFake({ envs: [{ key: "NODE_ENV", value: "production" }] });
    const c = collectIo();
    expect(await runDemoCommand("seed", args("db-unreachable", "--yes"), { env: { ...base }, io: c.io, fetchImpl: fake.fetchImpl, watch })).toBe(0);
    const body = fake.state.bodies.find((b) => b.call === "POST /v1/projects/update-envs")!.body as { variables: Array<{ key: string; value: string }> };
    expect(body.variables.map((v) => v.key)).toEqual(["NODE_ENV", "DB_HOST"]);
    expect(body.variables[1].value).toMatch(/\.invalid$/);
    expect(c.text()).not.toContain(body.variables[1].value);
  });

  it("reset to healthy redeploys v1 without needing --create", async () => {
    const fake = makeFake();
    const c = collectIo();
    expect(await runDemoCommand("reset", args("healthy", "--yes"), { env: { ...base }, io: c.io, fetchImpl: fake.fetchImpl, watch })).toBe(0);
    expect(c.text()).toContain("healthy (v1.0.0)");
  });

  it("reset rejects --create (usage) and refuses a missing app (guard)", async () => {
    expect(await runDemoCommand("reset", args("healthy", "--create"), { env: {}, io: collectIo().io })).toBe(1);
    const fake = makeFake({ exists: false });
    expect(await runDemoCommand("reset", args("healthy", "--yes"), { env: { ...base }, io: collectIo().io, fetchImpl: fake.fetchImpl, watch })).toBe(2);
  });

  it("--create with ALLOW_BILLED_LIVE_TESTS=1 creates the app (billed) then deploys", async () => {
    const fake = makeFake({ exists: false });
    const c = collectIo();
    const env = { ...base, ALLOW_BILLED_LIVE_TESTS: "1" };
    expect(await runDemoCommand("seed", args("healthy", "--create", "--plan", "iran-g2-small", "--network", "main", "--yes"), { env, io: c.io, fetchImpl: fake.fetchImpl, watch })).toBe(0);
    const created = fake.state.bodies.find((b) => b.call === "POST /v1/projects")!.body as Record<string, unknown>;
    expect(created).toMatchObject({ name: "broken-shop", planID: "iran-g2-small", platform: "node", bundlePlanID: "standard", network: "net1" });
    expect(fake.state.calls.indexOf("POST /v1/projects")).toBeLessThan(fake.state.calls.indexOf("POST /v2/projects/broken-shop/releases"));
    expect(c.text()).toContain("creating app (BILLED)");
  });

  it("dry-run with --create and a token prints the cost estimate from GET /v1/me only", async () => {
    const fake = makeFake({ exists: false });
    const c = collectIo();
    const env = { ...base, ALLOW_BILLED_LIVE_TESTS: "1" };
    expect(await runDemoCommand("seed", args("healthy", "--create", "--plan", "iran-g2-small"), { env, io: c.io, fetchImpl: fake.fetchImpl })).toBe(0);
    expect(fake.state.calls.every((x) => x.startsWith("GET "))).toBe(true);
    expect(c.text()).toContain("100/hour (~72000/month)");
    expect(c.text()).toContain("does not exist");
  });

  it("build-failure ending FAILED is the expected result (exit 0); an unexpected FAILED is exit 3", async () => {
    const failing = makeFake({ releaseState: "FAILED" });
    expect(await runDemoCommand("seed", args("build-failure", "--yes"), { env: { ...base }, io: collectIo().io, fetchImpl: failing.fetchImpl, watch })).toBe(0);
    const c = collectIo();
    const bad = makeFake({ releaseState: "FAILED" });
    expect(await runDemoCommand("seed", args("healthy", "--yes"), { env: { ...base }, io: c.io, fetchImpl: bad.fetchImpl, watch })).toBe(3);
  });

  it("Liara errors exit 3 with kind/code and no token", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ message: `Bearer ${TOKEN} rejected` }), { status: 401 });
    const c = collectIo();
    const code = await runDemoCommand("seed", args("healthy", "--yes"), { env: { ...base }, io: c.io, fetchImpl, watch });
    expect(code).toBe(3);
    expect(c.text()).toContain("kind=auth");
    expect(c.text()).not.toContain(TOKEN);
  });
});
