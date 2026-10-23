// Create / delete / redeploy / resize executors and source policy. Synthetic data only.
import { describe, expect, it } from "vitest";
import { assertSourceMayRun, executeAction } from "../../../lib/actions/executors";
import { execDeleteApp } from "../../../lib/actions/exec-delete";
import { Run } from "../../../lib/actions/run";
import { ACTION_POLICY, ACTION_TYPES, type ActionParams } from "../../../lib/contracts/action";
import type { ProposalSource } from "../../../lib/contracts/proposal";
import { SAMPLE_PARAMS } from "../contracts/samples";
import { setup, type TestEnv } from "./helpers";

const exec = (env: TestEnv, params: ActionParams, source: ProposalSource = "user") =>
  executeAction({ liara: env.liara.client(), accountId: env.accountId }, params, { source });

describe("source policy", () => {
  it("agent: only aiProposable types; setup: only deploy_plan; deletes: only a human", () => {
    for (const type of ACTION_TYPES) {
      const p = ACTION_POLICY[type];
      if (p.aiProposable) expect(() => assertSourceMayRun(type, "agent")).not.toThrow();
      else expect(() => assertSourceMayRun(type, "agent")).toThrow(expect.objectContaining({ code: "ai_not_allowed" }));
      if (type === "deploy_plan") expect(() => assertSourceMayRun(type, "setup")).not.toThrow();
      else expect(() => assertSourceMayRun(type, "setup")).toThrow();
      if (p.tier === 3) expect(() => assertSourceMayRun(type, "user")).not.toThrow();
    }
  });

  it("executeAction refuses an agent-sourced create or delete before any Liara call", async () => {
    const env = setup();
    env.liara.addApp("shop");
    for (const params of [SAMPLE_PARAMS.create_app, SAMPLE_PARAMS.delete_app, SAMPLE_PARAMS.delete_db, SAMPLE_PARAMS.create_network]) {
      await expect(exec(env, params, "agent")).rejects.toMatchObject({ code: "ai_not_allowed" });
      await expect(exec(env, params, "setup")).rejects.toMatchObject({ code: "ai_not_allowed" });
    }
    expect(env.liara.calls).toHaveLength(0);
  });

  it("the assistant may propose a deploy plan, but not one that creates billed resources", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const withCreate = { ...SAMPLE_PARAMS.deploy_plan };
    expect(withCreate.plan.steps.some((s) => s.kind === "create_app" || s.kind === "create_db")).toBe(true);
    await expect(exec(env, withCreate, "agent")).rejects.toMatchObject({ code: "ai_not_allowed", details: { reason: "creates_resources" } });
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("delete executors assert human-only themselves (defense in depth)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const run = new Run({ liara: env.liara.client(), accountId: env.accountId }, { source: "agent" });
    await expect(execDeleteApp(run, { type: "delete_app", app: "shop" })).rejects.toMatchObject({ code: "human_only" });
    expect(env.liara.apps.has("shop")).toBe(true);
  });
});

describe("create_app / create_db / create_network", () => {
  it("resolves the network NAME to its id with a fresh read, includes the cost, refetches", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    const r = await exec(env, { type: "create_app", name: "fresh", platform: "node", planId: "small-g2", network: "main" });
    const post = env.liara.calls.find((c) => c.method === "POST" && c.path === "/v1/projects")!;
    expect(post.body).toMatchObject({ name: "fresh", planID: "small-g2", bundlePlanID: "standard", network: "n1", platform: "node" });
    expect(r.summary).toMatchObject({ cost: { perHourToman: 100, perMonthToman: 72000 }, bundlePlanId: "standard", balanceChecked: true });
    expect(r.after).toMatchObject({ exists: true, planId: "small-g2" });
  });

  it("network created just before is found (no cache); unknown or ambiguous names fail clearly", async () => {
    const env = setup();
    await exec(env, { type: "create_network", name: "net-new" });
    await exec(env, { type: "create_app", name: "a1", platform: "node", planId: "small-g2", network: "net-new" });
    expect(env.liara.apps.get("a1")?.network?.name).toBe("net-new");
    await expect(exec(env, { type: "create_app", name: "a2", platform: "node", planId: "small-g2", network: "nope" })).rejects.toMatchObject({ code: "not_found" });
    env.liara.networks.push({ _id: "dup1", name: "twin" }, { _id: "dup2", name: "twin" });
    await expect(exec(env, { type: "create_app", name: "a3", platform: "node", planId: "small-g2", network: "twin" })).rejects.toMatchObject({ code: "ambiguous_network" });
  });

  it("bundle rules: explicit bundle validated, free plan uses 'free', ambiguous bundles need a choice", async () => {
    const env = setup();
    await exec(env, { type: "create_app", name: "f1", platform: "static", planId: "free", bundlePlanId: "free" });
    expect(env.liara.apps.get("f1")?.bundlePlanID).toBe("free");
    await expect(exec(env, { type: "create_app", name: "b1", platform: "node", planId: "big-g2" })).rejects.toMatchObject({ code: "invalid", details: { reason: "bundle_required" } });
    await exec(env, { type: "create_app", name: "b2", platform: "node", planId: "big-g2", bundlePlanId: "pro" });
    await expect(exec(env, { type: "create_app", name: "b3", platform: "node", planId: "gone-g2", bundlePlanId: "standard" })).rejects.toMatchObject({
      code: "invalid",
      details: { reason: "plan_unavailable" },
    });
  });

  it("insufficient balance is refused before the billed call; Liara 402/409 map to typed errors", async () => {
    const env = setup();
    env.liara.balance = 10;
    await expect(exec(env, { type: "create_app", name: "x1", platform: "node", planId: "small-g2" })).rejects.toMatchObject({ code: "insufficient_balance" });
    expect(env.liara.calls.some((c) => c.method === "POST")).toBe(false);
    env.liara.balance = undefined;
    env.liara.fault("POST /v1/projects", { status: 402, once: true });
    await expect(exec(env, { type: "create_app", name: "x2", platform: "node", planId: "small-g2" })).rejects.toMatchObject({ code: "payment_required" });
    env.liara.addApp("taken");
    await expect(exec(env, { type: "create_app", name: "taken", platform: "node", planId: "small-g2" })).rejects.toMatchObject({ code: "conflict" });
    env.liara.fault("POST /v1/projects", { status: 403, json: { message: "x", data: { code: "free_plan_platform" } }, once: true });
    await expect(exec(env, { type: "create_app", name: "x3", platform: "node", planId: "small-g2" })).rejects.toMatchObject({
      code: "forbidden",
      details: { liaraCode: "free_plan_platform" },
    });
  });

  it("create_db validates engine version and plan, resolves the network", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    await expect(exec(env, { type: "create_db", name: "d1", engine: "postgres", version: "9", planId: "db-small-g2", publicNetwork: false })).rejects.toMatchObject({
      code: "invalid",
      details: { reason: "version_unavailable" },
    });
    const r = await exec(env, { type: "create_db", name: "d1", engine: "postgres", version: "16", planId: "db-small-g2", network: "main", publicNetwork: false });
    expect(env.liara.dbs.find((d) => d.hostname === "d1")?.network).toEqual({ _id: "n1", name: "main" });
    expect(r.summary).toMatchObject({ cost: { perHourToman: 60 } });
  });
});

describe("deletes resolve the user-facing name", () => {
  it("delete_db by hostname uses the Liara ref in the path", async () => {
    const env = setup();
    env.liara.addDb("shop-db");
    await exec(env, { type: "delete_db", db: "shop-db" });
    expect(env.liara.calls.some((c) => c.method === "DELETE" && c.path === "/v1/databases/db_shop-db")).toBe(true);
    expect(env.liara.dbs).toHaveLength(0);
  });

  it("delete_disk fails (no silent not_found) when the disk listing breaks, and deletes nothing", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.disks.set("shop", [{ name: "uploads" }]);
    env.liara.fault("GET /v1/projects/id_shop/disks", { status: 500, json: { error: "Internal Server Error" } });
    await expect(exec(env, { type: "delete_disk", app: "shop", disk: "uploads" })).rejects.toBeTruthy();
    expect(env.liara.calls.some((c) => c.method === "DELETE" && c.path.includes("/disks/"))).toBe(false);
    expect(env.liara.disks.get("shop")).toHaveLength(1);
  });

  it("delete_domain by name, delete_disk by disk name; missing resources are not_found", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.domains.push({ _id: "d1", name: "shop.example.ir", project: "shop" });
    env.liara.disks.set("shop", [{ name: "uploads" }]);
    await exec(env, { type: "delete_domain", domain: "shop.example.ir" });
    await exec(env, { type: "delete_disk", app: "shop", disk: "uploads" });
    expect(env.liara.domains).toHaveLength(0);
    expect(env.liara.disks.get("shop")).toHaveLength(0);
    // the disk routes are addressed by the project _id (the by-name listing is a 500 on live Liara)
    const diskCalls = env.liara.calls.filter((c) => c.path.includes("/disks"));
    expect(diskCalls.length).toBeGreaterThan(0);
    expect(diskCalls.every((c) => c.path.startsWith("/v1/projects/id_shop/disks"))).toBe(true);
    expect(diskCalls.some((c) => c.method === "DELETE" && c.path === "/v1/projects/id_shop/disks/uploads")).toBe(true);
    await expect(exec(env, { type: "delete_domain", domain: "nope.example.ir" })).rejects.toMatchObject({ code: "not_found" });
    await expect(exec(env, { type: "delete_disk", app: "shop", disk: "uploads" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("redeploy_previous [VAL]", () => {
  function withHistory(env: TestEnv) {
    env.liara.addApp("shop");
    env.liara.releases.set("shop", [
      { _id: "r1", state: "READY", imageName: "registry.example/shop:v1", port: 3000, type: "node", createdAt: "2026-10-20T00:00:00.000Z", tag: "v1" },
      { _id: "r2", state: "READY", port: 3000, type: "node", createdAt: "2026-10-21T00:00:00.000Z", tag: "v2", sourceID: "src_2", sourceAvailable: true },
      { _id: "r3", state: "FAILED", port: 3000, type: "node", createdAt: "2026-10-21T12:00:00.000Z", tag: "v3" },
      { _id: "r4", state: "READY", port: 3000, type: "node", createdAt: "2026-10-22T00:00:00.000Z", tag: "v4" },
    ]);
    env.liara.current.set("shop", "r4");
  }

  it("redeploys the built image when it has one", async () => {
    const env = setup();
    withHistory(env);
    const r = await exec(env, { type: "redeploy_previous", app: "shop", releaseId: "r1" });
    const post = env.liara.calls.find((c) => c.method === "POST" && c.path === "/v2/projects/shop/releases")!;
    expect(post.body).toEqual({ image: "registry.example/shop:v1", port: 3000, type: "docker" });
    expect(r.summary).toMatchObject({ method: "image", fromReleaseId: "r1" });
  });

  it("falls back to the stored source, else refuses honestly", async () => {
    const env = setup();
    withHistory(env);
    await exec(env, { type: "redeploy_previous", app: "shop", releaseId: "r2" });
    expect(env.liara.calls.find((c) => c.method === "POST" && c.path === "/v2/projects/shop/releases")?.body).toMatchObject({ sourceID: "src_2", port: 3000 });
    const env2 = setup();
    withHistory(env2);
    env2.liara.releases.get("shop")![1].sourceID = undefined;
    await expect(exec(env2, { type: "redeploy_previous", app: "shop", releaseId: "r2" })).rejects.toMatchObject({ code: "unsupported" });
    expect(env2.liara.mutations()).toHaveLength(0);
  });

  it("refuses non-READY, current or foreign releases", async () => {
    const env = setup();
    withHistory(env);
    await expect(exec(env, { type: "redeploy_previous", app: "shop", releaseId: "r3" })).rejects.toMatchObject({ code: "invalid", details: { reason: "release_not_ready" } });
    await expect(exec(env, { type: "redeploy_previous", app: "shop", releaseId: "r4" })).rejects.toMatchObject({ code: "invalid", details: { reason: "already_current" } });
    await expect(exec(env, { type: "redeploy_previous", app: "shop", releaseId: "rel_other_app" })).rejects.toMatchObject({ code: "not_found" });
    expect(env.liara.mutations()).toHaveLength(0);
  });
});

describe("resize and scale", () => {
  it("resize reports the cost delta; a bundle change is refused, not ignored", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const r = await exec(env, { type: "resize", resource: { kind: "app", name: "shop" }, planId: "big-g2" });
    expect(r.summary).toMatchObject({ from: "small-g2", to: "big-g2", costDelta: { perHourToman: 300, perMonthToman: 216000 } });
    await expect(exec(env, { type: "resize", resource: { kind: "app", name: "shop" }, planId: "small-g2", bundlePlanId: "pro" })).rejects.toMatchObject({ code: "unsupported" });
    await expect(exec(env, { type: "resize", resource: { kind: "app", name: "shop" }, planId: "gone-g2" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("scale on a database resolves the hostname to the Liara ref", async () => {
    const env = setup();
    env.liara.addDb("shop-db");
    await exec(env, { type: "scale", resource: { kind: "db", name: "shop-db" }, scale: 0 });
    expect(env.liara.calls.some((c) => c.method === "POST" && c.path === "/v1/databases/db_shop-db/actions/scale")).toBe(true);
    expect(env.liara.dbs[0].scale).toBe(0);
  });
});
