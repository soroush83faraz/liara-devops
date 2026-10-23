import { describe, expect, it } from "vitest";
import { DeployPlanSchema, ProposalSchema, userValueKeys, type DeployPlan } from "@/lib/contracts";
import { createProposal, fingerprintState } from "@/lib/security";
import { explainPlan, explainPlanParts } from "@/lib/setup/explain";
import { buildDeployPlan, type PlanChoices, type PlanContext } from "@/lib/setup/plan";
import { PlanBodySchema } from "@/lib/setup/plan-request";
import { analyzeFixture } from "./helpers";
import { APP_PLANS, DB_PLANS, DB_VERSIONS, NETWORKS } from "./plans";

const ctx: PlanContext = { appPlans: APP_PLANS, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS, networks: NETWORKS, sourceRef: "a1b2c3d4e5f60718293a4b5c6d7e8f90" };
const choices = (over: Partial<PlanChoices> = {}): PlanChoices => ({
  appName: "my-shop",
  planId: "large-g2",
  includeDb: true,
  dbEngine: "postgres",
  dbPlanId: "db-small-g2",
  networkId: "net1",
  envChoices: [
    { name: "NEXTAUTH_SECRET", valueSource: "generated" },
    { name: "STRIPE_SECRET_KEY", valueSource: "user" },
    { name: "DATABASE_URL", valueSource: "user" },
  ],
  ...over,
});

async function planOk(over: Partial<PlanChoices> = {}, c: PlanContext = ctx): Promise<DeployPlan> {
  const a = await analyzeFixture("nextjs");
  const r = buildDeployPlan(a, choices(over), c);
  if (!r.ok) throw new Error(`plan failed: ${r.code}`);
  return r.plan;
}

describe("buildDeployPlan", () => {
  it("builds a plan that satisfies the DeployPlan contract", async () => {
    const plan = await planOk();
    expect(DeployPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.app).toBe("my-shop");
    expect(plan.network).toBe("main-net");
  });

  it("orders steps so the database exists before the app starts: app, db, env, wire, deploy, domain", async () => {
    const plan = await planOk();
    expect(plan.steps.map((s) => s.kind)).toEqual(["create_app", "create_db", "set_env", "wire_db", "deploy", "domain_guidance"]);
    expect(plan.steps.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
  });

  it("without a database: app, env, deploy, guidance", async () => {
    const plan = await planOk({ includeDb: false, networkId: undefined });
    expect(plan.steps.map((s) => s.kind)).toEqual(["create_app", "set_env", "deploy", "domain_guidance"]);
    expect(plan.network).toBeUndefined();
  });

  it("DB-wired keys are excluded from set_env; secrets are generated or user-provided but never carry a value", async () => {
    const plan = await planOk();
    const env = plan.steps.find((s) => s.kind === "set_env")!;
    if (env.kind !== "set_env") throw new Error("unreachable");
    expect(env.changes.map((c) => (c.op === "set" ? c.key : ""))).toEqual(["NEXTAUTH_SECRET", "STRIPE_SECRET_KEY"]);
    expect(env.changes[0]).toMatchObject({ valueSource: "generated", generator: "hex32" });
    expect(JSON.stringify(plan)).not.toMatch(/"value"/);
    const wire = plan.steps.find((s) => s.kind === "wire_db")!;
    expect(wire).toMatchObject({ db: "my-shop-db", mapping: { url: "DATABASE_URL" } });
    expect(userValueKeys({ type: "deploy_plan", plan })).toEqual(["STRIPE_SECRET_KEY"]);
  });

  it("cost totals equal the sum of billed steps", async () => {
    const plan = await planOk();
    expect(plan.totals.perHourToman).toBe(4000 + 600);
    expect(plan.totals.perMonthToman).toBe(4000 * 720 + 600 * 720);
  });

  it("a bundle plan adds its monthly price", async () => {
    const plan = await planOk({ planId: "medium-g2", bundlePlanId: "standard", includeDb: false });
    expect(plan.totals.perMonthToman).toBe(2000 * 720 + 36000);
    const create = plan.steps[0];
    expect(create.kind === "create_app" && create.bundlePlanId).toBe("standard");
  });

  it("deploy step: uploaded archive by reference, or a Docker image; port from choices > analysis > default", async () => {
    const up = (await planOk()).steps.find((s) => s.kind === "deploy")!;
    expect(up).toMatchObject({ source: { kind: "upload", uploadId: ctx.sourceRef }, port: 3100 });
    const img = (await planOk({ dockerImage: "registry.example.invalid/shop:1.2", port: 8080 }, { ...ctx, sourceRef: undefined })).steps.find((s) => s.kind === "deploy")!;
    expect(img).toMatchObject({ source: { kind: "image", image: "registry.example.invalid/shop:1.2" }, port: 8080 });
  });

  const reject = async (over: Partial<PlanChoices>, code: string, c: PlanContext = ctx) => {
    const a = await analyzeFixture("nextjs");
    const r = buildDeployPlan(a, choices(over), c);
    expect(r).toMatchObject({ ok: false, code });
  };

  it("re-validates every choice against the account", async () => {
    await reject({ appName: "Bad Name" }, "invalid_app_name");
    await reject({ planId: "nope" }, "unknown_plan");
    await reject({ planId: "down-g2" }, "unknown_plan");
    await reject({ planId: undefined }, "unknown_plan");
    await reject({ bundlePlanId: "pro", planId: "medium-g2" }, "unknown_bundle");
    await reject({ networkId: "ghost" }, "unknown_network");
    await reject({ dbPlanId: "nope" }, "unknown_db_plan");
    await reject({ dbEngine: "mssql", dbPlanId: "db-small-g2" }, "unknown_db_plan");
    await reject({ dbEngine: "elasticsearch" }, "no_db_version");
    await reject({ dbName: "Bad_DB" }, "invalid_db_name");
    await reject({ port: 70000 }, "invalid_port");
    await reject({ domain: "not a domain" }, "invalid_domain");
    await reject({ envChoices: [{ name: "bad name", valueSource: "user" }] }, "invalid_env");
    await reject({ dbEnvKeys: { url: "NEXT_PUBLIC_DB" } }, "invalid_wire_keys");
    await reject({}, "no_deploy_source", { ...ctx, sourceRef: undefined });
    await reject({ dockerImage: "Bad Image!" }, "invalid_image");
  });

  it("an unknown platform needs the user's choice", async () => {
    const a = await analyzeFixture("empty-unknown");
    expect(buildDeployPlan(a, choices(), ctx)).toMatchObject({ ok: false, code: "platform_required" });
    const r = buildDeployPlan(a, choices({ platform: "static", includeDb: false }), ctx);
    expect(r.ok && r.plan.steps[0]).toMatchObject({ kind: "create_app", platform: "static" });
  });
});

describe("request schema", () => {
  it("rejects unknown fields and values in env choices", () => {
    const ok = { choices: choices() };
    expect(PlanBodySchema.safeParse(ok).success).toBe(true);
    expect(PlanBodySchema.safeParse({ choices: { ...choices(), extra: 1 } }).success).toBe(false);
    expect(PlanBodySchema.safeParse({ choices: { ...choices(), envChoices: [{ name: "A_B", valueSource: "user", value: "x" }] } }).success).toBe(false);
  });
});

describe("explainPlan (rule-based Persian text)", () => {
  it("mentions the app, the platform, the database and the monthly cost, and never claims the domain is done", async () => {
    const plan = await planOk();
    const text = explainPlan(plan);
    expect(text).toContain("my-shop");
    expect(text).toContain("Next.js");
    expect(text).toContain("PostgreSQL");
    expect(text).toContain("۳"); // Persian digits in the cost
    const parts = explainPlanParts(plan);
    expect(parts.steps).toHaveLength(plan.steps.length);
    // Counts and ports in the step list use Persian digits like the rest of the copy («تنظیم ۲ متغیر محیطی»).
    expect(parts.steps.find((x) => x.includes("متغیر محیطی"))).toMatch(/^تنظیم [۰-۹]+ متغیر محیطی/);
    expect(parts.steps.join(" | ")).not.toMatch(/(پورت|تنظیم) [0-9]/);
    expect(parts.domain.length).toBeGreaterThan(3);
    expect(text).not.toMatch(/[A-Za-z_]+_[A-Za-z_]+=/);
  });
});

describe("persisting as a setup proposal", () => {
  it("createProposal accepts the plan with source 'setup', no evidence, and a cost estimate", async () => {
    const built = buildDeployPlan(await analyzeFixture("nextjs"), choices(), ctx);
    if (!built.ok) throw new Error(built.code);
    const p = createProposal({
      accountId: "acct_test",
      params: { type: "deploy_plan", plan: built.plan },
      source: "setup",
      rationaleFa: "دلیل",
      evidenceIds: [],
      effectFa: "اثر",
      risksFa: ["ریسک"],
      verificationPlan: ["بررسی"],
      costEstimate: built.costs.totals,
      stateFingerprint: fingerprintState({ kind: "project", name: built.plan.app }),
    });
    expect(ProposalSchema.safeParse(p).success).toBe(true);
    expect(p).toMatchObject({ type: "deploy_plan", source: "setup", status: "proposed", target: { kind: "app", name: "my-shop" } });
  });
});
