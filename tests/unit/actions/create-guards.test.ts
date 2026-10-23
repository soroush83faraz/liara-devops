// Defence in depth for billed creates (synthetic fake Liara). The UI wizard already blocks unpriced plans and
// low balances; the server-side executor must refuse them too, before any POST.
import { describe, expect, it } from "vitest";
import { executeAction } from "../../../lib/actions/executors";
import type { ActionParams } from "../../../lib/contracts/action";
import { messageFor } from "../../../lib/actions/messages";
import { setup, type TestEnv } from "./helpers";

const exec = (env: TestEnv, params: ActionParams) => executeAction({ liara: env.liara.client(), accountId: env.accountId }, params, { source: "user" });
const posts = (env: TestEnv) => env.liara.calls.filter((c) => c.method === "POST");

/** A /v1/me where `mystery-g2` (app) and `db-mystery-g2` (db) have no price and `free` is the free plan. */
function unpricedMe() {
  return {
    user: { _id: "u1" },
    databaseVersions: { postgres: [{ label: "16", value: "16" }] },
    plans: {
      projects: {
        "mystery-g2": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5 },
        "zero-g2": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5, price: 0 },
        free: { available: true, region: "iran", price: 0 },
      },
      projectBundlePlans: { "mystery-g2": { standard: { available: true, displayPrice: 50000 } }, "zero-g2": { standard: { available: true, displayPrice: 50000 } } },
      databases: { "db-mystery-g2": { available: true, region: "iran", supports: ["postgres"] }, free: { available: true, region: "iran", supports: ["postgres"] } },
      databaseBundlePlans: { "db-mystery-g2": { standard: { available: true, displayPrice: 10000 } } },
    },
  };
}

describe("create_app / create_db refuse an unpriced plan", () => {
  it("create_app on a plan without a price: plan_price_unknown, nothing POSTed", async () => {
    const env = setup();
    env.liara.me = unpricedMe();
    for (const planId of ["mystery-g2", "zero-g2"]) {
      await expect(exec(env, { type: "create_app", name: "x1", platform: "node", planId })).rejects.toMatchObject({
        code: "plan_price_unknown",
        status: 422,
        details: { planId },
      });
    }
    expect(posts(env)).toHaveLength(0);
    expect(env.liara.apps.size).toBe(0);
  });

  it("create_db on a plan without a price: plan_price_unknown, nothing POSTed", async () => {
    const env = setup();
    env.liara.me = unpricedMe();
    await expect(exec(env, { type: "create_db", name: "d1", engine: "postgres", version: "16", planId: "db-mystery-g2", publicNetwork: false })).rejects.toMatchObject({
      code: "plan_price_unknown",
    });
    expect(posts(env)).toHaveLength(0);
    expect(env.liara.dbs).toHaveLength(0);
  });

  it("the legitimate free plan is still created (cost 0, no balance needed)", async () => {
    const env = setup();
    env.liara.me = unpricedMe();
    env.liara.balance = 0;
    const r = await exec(env, { type: "create_app", name: "f1", platform: "static", planId: "free", bundlePlanId: "free" });
    expect(r.summary).toMatchObject({ planId: "free", cost: { perHourToman: 0 } });
    expect(env.liara.apps.has("f1")).toBe(true);
  });

  it("an unreadable /v1/me (price cannot be known) also refuses a non-free plan", async () => {
    const env = setup();
    env.liara.fault("GET /v1/me", { status: 500 });
    await expect(exec(env, { type: "create_app", name: "x2", platform: "node", planId: "small-g2", bundlePlanId: "standard" })).rejects.toMatchObject({
      code: "plan_price_unknown",
    });
    expect(posts(env)).toHaveLength(0);
  });

  it("has Persian copy", () => {
    expect(messageFor("plan_price_unknown")).toMatch(/قیمت/);
  });
});

describe("create_app / create_db enforce the balance server-side", () => {
  it("balance below one hour of the cost: insufficient_balance (402), nothing POSTed", async () => {
    const env = setup();
    env.liara.balance = 99; // small-g2 costs 100/h in the fake
    await expect(exec(env, { type: "create_app", name: "a1", platform: "node", planId: "small-g2" })).rejects.toMatchObject({ code: "insufficient_balance", status: 402 });
    env.liara.balance = 59; // db-small-g2 costs 60/h
    await expect(exec(env, { type: "create_db", name: "d1", engine: "postgres", version: "16", planId: "db-small-g2", publicNetwork: false })).rejects.toMatchObject({
      code: "insufficient_balance",
    });
    expect(posts(env)).toHaveLength(0);
  });

  it("balance of exactly one hour passes and the summary says it was checked", async () => {
    const env = setup();
    env.liara.balance = 100;
    const r = await exec(env, { type: "create_app", name: "a2", platform: "node", planId: "small-g2" });
    expect(r.summary).toMatchObject({ balanceChecked: true });
  });

  it("a zero balance blocks a priced create but not the free plan", async () => {
    const env = setup();
    env.liara.balance = 0;
    await expect(exec(env, { type: "create_app", name: "a3", platform: "node", planId: "small-g2" })).rejects.toMatchObject({ code: "insufficient_balance" });
    await exec(env, { type: "create_app", name: "a4", platform: "static", planId: "free", bundlePlanId: "free" });
    expect(env.liara.apps.has("a4")).toBe(true);
  });

  it("an unreadable balance does not block (the wizard showed the cost; Liara itself answers 402)", async () => {
    const env = setup();
    env.liara.fault("GET /v1/billing", { status: 500 });
    const r = await exec(env, { type: "create_app", name: "a5", platform: "node", planId: "small-g2" });
    expect(r.summary).toMatchObject({ balanceChecked: false });
  });
});
