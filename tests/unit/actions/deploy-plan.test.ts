// deploy_plan: steps run in the given order through the other executors; the first failure stops the plan and
// reports what exists; nothing is rolled back. Synthetic data only.
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { executeAction, type StepEvent } from "../../../lib/actions/executors";
import type { ActionParamsOf } from "../../../lib/contracts/action";
import { costFromHourly } from "../../../lib/contracts/common";
import type { DeployPlan } from "../../../lib/contracts/deploy-plan";
import type { StoredSource } from "../../../lib/setup/source-store";
import { tarGzOf } from "../setup/helpers";
import { setup, type TestEnv } from "./helpers";

const ZIP = zipSync({ "package.json": strToU8('{"name":"shop","scripts":{"start":"node index.js"}}'), "index.js": strToU8("require('http').createServer((q,s)=>s.end('ok')).listen(3000)") });
const TGZ = tarGzOf({ "package.json": '{"name":"shop"}', "index.js": "require('http').createServer((q,s)=>s.end('ok')).listen(3000)" });
/** Valid gzip framing around a tar whose second entry escapes the project directory. */
const EVIL_TGZ = tarGzOf({ "package.json": "{}", "../../etc/cron.d/x": "boom" });
/** Two gzip members: the second hides an entry from readers that stop after the first. */
const MULTI_MEMBER_TGZ = new Uint8Array(Buffer.concat([tarGzOf({ "package.json": "{}" }), tarGzOf({ "../member2": "x" })]));

function plan(over: Partial<DeployPlan> = {}): DeployPlan {
  return {
    app: "shop",
    network: "main",
    steps: [
      { id: "S1", kind: "create_app", name: "shop", platform: "node", planId: "small-g2", bundlePlanId: "standard", network: "main", cost: costFromHourly(100) },
      { id: "S2", kind: "create_db", name: "shop-db", engine: "postgres", version: "16", planId: "db-small-g2", bundlePlanId: "standard", network: "main", publicNetwork: false, cost: costFromHourly(60) },
      { id: "S3", kind: "set_env", app: "shop", changes: [{ op: "set", key: "SESSION_SECRET", valueSource: "generated", generator: "hex32" }] },
      { id: "S4", kind: "wire_db", app: "shop", db: "shop-db", mapping: { url: "DATABASE_URL" } },
      { id: "S5", kind: "deploy", app: "shop", source: { kind: "upload", uploadId: "up_1" }, port: 3000 },
      { id: "S6", kind: "domain_guidance" },
    ],
    totals: costFromHourly(160),
    ...over,
  };
}

async function runPlan(env: TestEnv, p: DeployPlan, bytes: Uint8Array = ZIP) {
  const steps: StepEvent[] = [];
  const getSource = async (accountId: string, ref: string): Promise<StoredSource | null> =>
    accountId === env.accountId && ref === "up_1" ? { ref, fileName: "app.zip", size: bytes.byteLength, bytes, createdAt: 0 } : null;
  const params: ActionParamsOf<"deploy_plan"> = { type: "deploy_plan", plan: p };
  const result = executeAction({ liara: env.liara.client(), accountId: env.accountId }, params, {
    source: "setup",
    onStep: (e) => steps.push(e),
    deploy: { watchTimeoutMs: 5_000, queueIntervalMs: 0, logIntervalMs: 0 },
    getSource,
  });
  return { result, steps };
}

const mutationPaths = (env: TestEnv) => env.liara.mutations().map((c) => `${c.method} ${c.path}`);

describe("deploy_plan", () => {
  it("runs every step in the given order and reports per-step status", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    const { result, steps } = await runPlan(env, plan());
    const r = await result;
    expect(mutationPaths(env)).toEqual([
      "POST /v1/projects",
      "POST /v1/databases",
      "POST /v1/projects/update-envs",
      "POST /v1/projects/update-envs",
      "POST /v2/projects/shop/sources",
      "POST /v2/projects/shop/releases",
    ]);
    expect(r.summary).toMatchObject({ app: "shop", completed: ["S1", "S2", "S3", "S4", "S5"], created: { app: true, dbs: ["shop-db"] }, guidance: { domain: null } });
    const top = steps.filter((s) => /^S\d$/.test(s.step)).map((s) => `${s.step}:${s.status}`);
    expect(top).toEqual(["S1:running", "S1:done", "S2:running", "S2:done", "S3:running", "S3:done", "S4:running", "S4:done", "S5:running", "S5:done", "S6:skipped"]);
    const envs = Object.fromEntries(env.liara.apps.get("shop")!.envs.map((e) => [e.key, e.value]));
    expect(envs.DATABASE_URL).toContain("@shop-db:5432/appdb");
    expect(envs.SESSION_SECRET).toMatch(/^[a-f0-9]{64}$/);
    // Step details never carry values.
    const detailText = JSON.stringify(steps);
    expect(detailText).not.toContain(envs.SESSION_SECRET);
    expect(detailText).not.toContain(env.liara.dbs[0].password!);
  });

  it("stops at the first failed step, reports what exists, never rolls back", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    env.liara.fault("POST /v1/databases", { status: 402 });
    const { result, steps } = await runPlan(env, plan());
    await expect(result).rejects.toMatchObject({
      code: "step_failed",
      details: { failedStep: "S2", failedKind: "create_db", error: "payment_required", completed: ["S1"], created: { app: true, dbs: [], releaseId: null } },
    });
    expect(mutationPaths(env)).toEqual(["POST /v1/projects", "POST /v1/databases"]);
    expect(env.liara.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(env.liara.apps.has("shop")).toBe(true);
    expect(steps.find((s) => s.step === "S2" && s.status === "failed")?.detail).toBe("payment_required");
    expect(steps.some((s) => s.step === "S3")).toBe(false);
  });

  it("a failed build stops the plan at the deploy step", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    env.liara.releaseFinalState = "FAILED";
    const { result } = await runPlan(env, plan());
    await expect(result).rejects.toMatchObject({ code: "step_failed", details: { failedStep: "S5", error: "release_failed", completed: ["S1", "S2", "S3", "S4"] } });
  });

  it("a .tar.gz upload (gzip magic) goes to Liara as-is; unknown bytes are refused", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    const onlyDeploy = plan({ network: undefined, steps: [{ id: "S1", kind: "deploy", app: "shop", source: { kind: "upload", uploadId: "up_1" }, port: 3000 }], totals: costFromHourly(0) });
    env.liara.addApp("shop");
    const { result } = await runPlan(env, onlyDeploy, TGZ);
    await result;
    expect(mutationPaths(env)).toEqual(["POST /v2/projects/shop/sources", "POST /v2/projects/shop/releases"]);
    const env2 = setup();
    env2.liara.addApp("shop");
    const bad = await runPlan(env2, onlyDeploy, new Uint8Array([1, 2, 3, 4]));
    await expect(bad.result).rejects.toMatchObject({ code: "step_failed", details: { errorDetails: { reason: "archive_unknown_format" } } });
    expect(env2.liara.mutations()).toHaveLength(0);
  });

  it("a .tar.gz from setup gets the deploy route's strict scan BEFORE upload (traversal, multi-member, garbage)", async () => {
    const onlyDeploy = plan({ network: undefined, steps: [{ id: "S1", kind: "deploy", app: "shop", source: { kind: "upload", uploadId: "up_1" }, port: 3000 }], totals: costFromHourly(0) });
    const cases: Array<[Uint8Array, string]> = [
      [EVIL_TGZ, "archive_unsafe_path"],
      [MULTI_MEMBER_TGZ, "archive_invalid_zip"],
      [new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3, 4]), "archive_invalid_zip"],
    ];
    for (const [bytes, reason] of cases) {
      const env = setup();
      env.liara.addApp("shop");
      const run = await runPlan(env, onlyDeploy, bytes);
      await expect(run.result).rejects.toMatchObject({ code: "step_failed", details: { errorDetails: { reason } } });
      expect(env.liara.mutations(), reason).toHaveLength(0);
    }
  });

  it("insufficient balance for the plan total stops it before any step", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    env.liara.balance = 50;
    const { result } = await runPlan(env, plan());
    await expect(result).rejects.toMatchObject({ code: "insufficient_balance" });
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("Liara refusing env vars on a never-deployed app surfaces as a clear step error [VAL]", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    env.liara.fault("POST /v1/projects/update-envs", { status: 400, json: { message: "project_not_deployed" } });
    const { result } = await runPlan(env, plan());
    await expect(result).rejects.toMatchObject({ code: "step_failed", details: { failedStep: "S3", failedKind: "set_env", error: "invalid", errorDetails: { liaraCode: "project_not_deployed" } } });
  });

  it("the setup source may only run deploy_plan; the upload must belong to the account", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const onlyDeploy = plan({ network: undefined, steps: [{ id: "S1", kind: "deploy", app: "shop", source: { kind: "upload", uploadId: "up_other" }, port: 3000 }], totals: costFromHourly(0) });
    const { result } = await runPlan(env, onlyDeploy);
    await expect(result).rejects.toMatchObject({ code: "step_failed", details: { error: "not_found" } });
  });
});
