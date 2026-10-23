// Billed creates in team mode (synthetic fake Liara serving the recorded dual user+team billing shape, see
// tests/fixtures/recorded/team-billing-2026-10-23.json): the TEAM balance decides, never the person's.
import { describe, expect, it } from "vitest";
import { executeAction } from "../../../lib/actions/executors";
import type { ActionParams } from "../../../lib/contracts/action";
import { computeTargetFingerprint } from "../../../lib/actions/fingerprint";
import { messageFor } from "../../../lib/actions/messages";
import fx from "../../fixtures/recorded/team-billing-2026-10-23.json";
import { setup, type TestEnv } from "./helpers";

const TEAM = "SYNTH-TEAM-0001";
const exec = (env: TestEnv, params: ActionParams, teamId = TEAM) =>
  executeAction({ liara: env.liara.client({ teamId }), accountId: env.accountId }, params, { source: "user" });
const posts = (env: TestEnv) => env.liara.calls.filter((c) => c.method === "POST");
const createSmall = (name: string): ActionParams => ({ type: "create_app", name, platform: "node", planId: "small-g2" }); // 100/h in the fake

describe("billed create in team mode", () => {
  it("passes on team.balance (2,000,000) although user.balance is 0.6", async () => {
    const env = setup({ teamId: TEAM });
    env.liara.billingBody = fx.billingTeamMode;
    const r = await exec(env, createSmall("t1"));
    expect(r.summary).toMatchObject({ balanceChecked: true });
    expect(env.liara.apps.has("t1")).toBe(true);
  });

  it("the same response in PERSONAL mode would refuse (0.6 < 100/h): proves the source choice matters", async () => {
    const env = setup();
    env.liara.billingBody = fx.billingTeamMode;
    await expect(exec(env, createSmall("p1"), "")).rejects.toMatchObject({ code: "insufficient_balance", status: 402 });
    expect(posts(env)).toHaveLength(0);
  });

  it("team balance below one hour of the cost: insufficient_balance, nothing POSTed", async () => {
    const env = setup({ teamId: TEAM });
    env.liara.billingBody = { user: { balance: 9e6 }, team: { balance: 50, minCreditAmount: 20000 } };
    await expect(exec(env, createSmall("t2"))).rejects.toMatchObject({ code: "insufficient_balance" });
    expect(posts(env)).toHaveLength(0);
  });

  it("team id but no team object: team_balance_unreadable (402), nothing POSTed, personal balance not used", async () => {
    const env = setup({ teamId: TEAM });
    env.liara.billingBody = { user: fx.billingTeamMode.user };
    await expect(exec(env, createSmall("t3"))).rejects.toMatchObject({ code: "team_balance_unreadable", status: 402 });
    env.liara.billingBody = { user: { balance: 9e9 } }; // even a huge personal balance must not unlock it
    await expect(exec(env, createSmall("t3"))).rejects.toMatchObject({ code: "team_balance_unreadable" });
    expect(posts(env)).toHaveLength(0);
    expect(messageFor("team_balance_unreadable")).toMatch(/تیم/);
  });

  it("the free plan needs no balance, so it still works when the team balance is unreadable", async () => {
    const env = setup({ teamId: TEAM });
    env.liara.billingBody = { user: fx.billingTeamMode.user };
    env.liara.me = { user: { _id: "u1" }, plans: { projects: { free: { available: true, region: "iran", price: 0 } }, projectBundlePlans: {}, databases: {}, databaseBundlePlans: {} } };
    const r = await exec(env, { type: "create_app", name: "f1", platform: "static", planId: "free", bundlePlanId: "free" });
    expect(r.summary).toMatchObject({ planId: "free" });
  });

  it("plan_price_unknown is still refused in team mode, even with a rich team balance", async () => {
    const env = setup({ teamId: TEAM });
    env.liara.billingBody = fx.billingTeamMode;
    env.liara.me = {
      user: { _id: "u1" },
      plans: { projects: { "mystery-g2": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5 } }, projectBundlePlans: { "mystery-g2": { standard: { available: true, displayPrice: 1 } } }, databases: {}, databaseBundlePlans: {} },
    };
    await expect(exec(env, { type: "create_app", name: "m1", platform: "node", planId: "mystery-g2" })).rejects.toMatchObject({ code: "plan_price_unknown", status: 422 });
    expect(posts(env)).toHaveLength(0);
  });
});

describe("team mode: ANY unreadable billing refuses a priced create", () => {
  const failures: Array<[string, (env: TestEnv) => void]> = [
    ["HTTP 403", (env) => env.liara.fault("GET /v1/billing", { status: 403 })],
    ["HTTP 500", (env) => env.liara.fault("GET /v1/billing", { status: 500 })],
    ["network error", (env) => env.liara.fault("GET /v1/billing", { network: true })],
    ["200 with body []", (env) => void (env.liara.billingBody = [])],
    ["200 with body null", (env) => void (env.liara.billingBody = null)],
    ["200 with an HTML page", (env) => env.liara.fault("GET /v1/billing", { status: 200, raw: "<!doctype html><html><body>Bad gateway</body></html>" })],
    ["200 with a JSON string", (env) => void (env.liara.billingBody = "<html></html>")],
    ["200 with {} (no team object)", (env) => void (env.liara.billingBody = {})],
  ];
  for (const [label, arrange] of failures) {
    it(`${label}: team_balance_unreadable (402), nothing created`, async () => {
      const env = setup({ teamId: TEAM });
      arrange(env);
      await expect(exec(env, createSmall("u1"))).rejects.toMatchObject({ code: "team_balance_unreadable", status: 402 });
      expect(posts(env)).toHaveLength(0);
      expect(env.liara.apps.size).toBe(0);
    });
  }

  it("a priced create_db is refused the same way", async () => {
    const env = setup({ teamId: TEAM });
    env.liara.fault("GET /v1/billing", { status: 500 });
    await expect(exec(env, { type: "create_db", name: "d1", engine: "postgres", version: "16", planId: "db-small-g2", publicNetwork: false })).rejects.toMatchObject({ code: "team_balance_unreadable" });
    expect(posts(env)).toHaveLength(0);
  });

  it("the free plan stays unaffected by an unreadable team billing", async () => {
    const env = setup({ teamId: TEAM });
    env.liara.fault("GET /v1/billing", { status: 500 });
    env.liara.me = { user: { _id: "u1" }, plans: { projects: { free: { available: true, region: "iran", price: 0 } }, projectBundlePlans: {}, databases: {}, databaseBundlePlans: {} } };
    const r = await exec(env, { type: "create_app", name: "f2", platform: "static", planId: "free", bundlePlanId: "free" });
    expect(r.summary).toMatchObject({ planId: "free" });
  });

  it("personal mode keeps best-effort: unreadable billing -> balanceChecked:false (Liara itself answers 402)", async () => {
    const env = setup();
    env.liara.fault("GET /v1/billing", { status: 500 });
    const r = await exec(env, createSmall("p9"), "");
    expect(r.summary).toMatchObject({ balanceChecked: false });
    expect(env.liara.apps.has("p9")).toBe(true);
  });
});

describe("team context is part of the target fingerprint", () => {
  it("personal and each team produce different fingerprints for the same target", async () => {
    const env = setup();
    const target = { kind: "app", name: "demo" } as const;
    const fp = (teamId?: string) => computeTargetFingerprint(env.liara.client({ teamId }), target);
    const [personal, a, b] = await Promise.all([fp(undefined), fp("SYNTH-TEAM-A"), fp("SYNTH-TEAM-B")]);
    expect(new Set([personal, a, b]).size).toBe(3);
  });
});
