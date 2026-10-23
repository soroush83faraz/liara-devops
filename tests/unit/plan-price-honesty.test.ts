// Plans whose price is missing in GET /v1/me must never be costed as free, recommended or proposed.
// All inputs are SYNTHETIC.
import { describe, expect, it } from "vitest";
import { MeSchema } from "@/lib/liara";
import type { NormalizedPlan } from "@/lib/liara/account";
import { choosePlan, costDelta } from "@/lib/actions/plans";
import { pickDbPlan, pickPlan } from "@/lib/setup/sizing";
import { recommendSetup } from "@/lib/setup/recommend";
import { toCatalogView } from "@/lib/setup/catalog";
import { buildDeployPlan, type PlanChoices, type PlanContext } from "@/lib/setup/plan";
import { normalizePlans } from "@/lib/create/plans";
import { buildPlanOptions, comparePlans as comparePlansDb } from "@/lib/service/db/plans";
import { toOverviewDto } from "@/lib/service/db/dto";
import { comparePlans as comparePlansApp } from "@/lib/service/app-config/plans";
import { toPlanOptions } from "@/lib/service/app-config/mappers";
import { DatabaseDetailResponseSchema } from "@/lib/liara";
import { analyzeFixture } from "./setup/helpers";
import { APP_PLANS, DB_PLANS, DB_VERSIONS, NETWORKS, plan } from "./setup/plans";

const unpriced = (id: string, ram: number, cpu: number, extra: Partial<NormalizedPlan> = {}) =>
  plan(id, ram, cpu, 0, { priceKnown: false, ...extra });

describe("sizing and recommendation skip unpriced plans", () => {
  it("pickPlan never chooses (or offers as alternative) an unpriced plan, even when it is the cheapest/smallest", () => {
    const plans = [unpriced("mystery-g2", 1, 1), plan("small-g2", 0.5, 0.5, 1000), plan("medium-g2", 1, 1, 2000)];
    const pick = pickPlan(plans, { ramGb: 0.25, cpu: 0.25 })!;
    expect(pick.chosen.id).toBe("small-g2");
    expect([pick.smaller?.id, pick.bigger?.id]).not.toContain("mystery-g2");
    expect(pickPlan(plans, { ramGb: 1, cpu: 1 })!.chosen.id).toBe("medium-g2");
  });

  it("pickPlan/pickDbPlan return nothing when no plan is priced", () => {
    expect(pickPlan([unpriced("a-g2", 1, 1), unpriced("b-g2", 2, 2)], { ramGb: 0.25, cpu: 0.25 })).toBeUndefined();
    expect(pickDbPlan([unpriced("db-g2", 1, 1)], "postgres")).toBeUndefined();
  });

  it("recommendSetup with only unpriced app plans: no plan, no cost line, explicit note", async () => {
    const a = await analyzeFixture("nextjs");
    const rec = recommendSetup(a, { appPlans: [unpriced("a-g2", 2, 2)], dbPlans: [unpriced("db-g2", 2, 2)], dbVersions: DB_VERSIONS });
    expect(rec.appPlan).toBeUndefined();
    expect(rec.notes).toContain("no_app_plans");
    expect(rec.costs.app).toBeUndefined();
    expect(rec.costs.totals).toEqual({ perHourToman: 0, perMonthToman: 0 });
    expect(rec.costs.totals).not.toHaveProperty("app");
  });

  it("the browser catalog hides unpriced plans", () => {
    const view = toCatalogView({
      appPlans: [unpriced("a-g2", 1, 1), ...APP_PLANS],
      dbPlans: [unpriced("db-g2", 1, 1), ...DB_PLANS],
      dbVersions: DB_VERSIONS,
      networks: NETWORKS,
    });
    expect(view.appPlans.map((p) => p.id)).not.toContain("a-g2");
    expect(view.dbPlans.map((p) => p.id)).not.toContain("db-g2");
    expect(view.appPlans.length).toBeGreaterThan(0);
  });
});

describe("buildDeployPlan refuses unpriced plans", () => {
  const ctx: PlanContext = {
    appPlans: [unpriced("mystery-g2", 1, 1), ...APP_PLANS],
    dbPlans: [unpriced("db-mystery-g2", 1, 1, { supports: ["postgres"] }), ...DB_PLANS],
    dbVersions: DB_VERSIONS,
    networks: NETWORKS,
    sourceRef: "src_1",
  };
  const choices = (o: Partial<PlanChoices> = {}): PlanChoices => ({ appName: "my-shop", platform: "next", planId: "small-g2", envChoices: [], ...o });

  it("an unpriced app plan is not a valid choice (it would total 0)", async () => {
    const a = await analyzeFixture("nextjs");
    expect(buildDeployPlan(a, choices({ planId: "mystery-g2" }), ctx)).toMatchObject({ ok: false, code: "unknown_plan" });
    expect(buildDeployPlan(a, choices(), ctx)).toMatchObject({ ok: true });
  });

  it("an unpriced db plan is not a valid choice", async () => {
    const a = await analyzeFixture("nextjs");
    const r = buildDeployPlan(a, choices({ includeDb: true, dbEngine: "postgres", dbPlanId: "db-mystery-g2" }), ctx);
    expect(r).toMatchObject({ ok: false, code: "unknown_db_plan" });
  });
});

describe("billed actions never cost an unpriced plan as free", () => {
  const plans = [plan("small-g2", 1, 1, 100), unpriced("mystery-g2", 2, 2), plan("free", 0.25, 0.25, 0, { priceKnown: true })];

  it("choosePlan: no cost for an unpriced plan, a real 0 for the free plan", () => {
    expect(choosePlan(plans, "mystery-g2", "free").cost).toBeUndefined();
    expect(choosePlan(plans, "small-g2", "free").cost).toEqual({ perHourToman: 100, perMonthToman: 72000 });
    expect(choosePlan(plans, "free", undefined).cost).toEqual({ perHourToman: 0, perMonthToman: 0 });
  });

  it("costDelta is null when either side is unpriced", () => {
    expect(costDelta(plans, "small-g2", "mystery-g2")).toBeNull();
    expect(costDelta(plans, "mystery-g2", "small-g2")).toBeNull();
    expect(costDelta(plans, "small-g2", "free")).toEqual({ perHourToman: -100, perMonthToman: -72000 });
  });
});

describe("db plan comparison", () => {
  const known = { pricePerHour: 100, priceKnown: true };
  const none = { pricePerHour: 0, priceKnown: false };

  it("delta is unknown (not +/- the other price) when either price is unknown", () => {
    expect(comparePlansDb(none, known)).toEqual({ direction: "unknown" });
    expect(comparePlansDb(known, none)).toEqual({ direction: "unknown" });
    expect(comparePlansDb(known, known)).toMatchObject({ direction: "same" });
  });

  it("buildPlanOptions omits the numbers of an unpriced plan and sorts it last", () => {
    const list = [unpriced("mystery-g2", 1, 1), plan("small-g2", 1, 1, 100), plan("big-g2", 2, 2, 250)];
    const opts = buildPlanOptions(list, list, "small-g2");
    expect(opts.map((o) => o.id)).toEqual(["small-g2", "big-g2", "mystery-g2"]);
    const m = opts.find((o) => o.id === "mystery-g2")!;
    expect(m).toMatchObject({ priceKnown: false, direction: "unknown" });
    expect(m).not.toHaveProperty("pricePerHour");
    expect(m).not.toHaveProperty("pricePerMonth");
    expect(m).not.toHaveProperty("deltaPerMonth");
    expect(opts.find((o) => o.id === "big-g2")).toMatchObject({ priceKnown: true, direction: "up", deltaPerHour: 150 });
    // an unpriced CURRENT plan makes every delta unknown
    const o2 = buildPlanOptions(list, list, "mystery-g2");
    expect(o2.every((o) => o.direction === "unknown" || o.current)).toBe(true);
  });

  it("overview DTO omits pricePerMonth for an unpriced plan", () => {
    const detail = DatabaseDetailResponseSchema.parse({ database: { _id: "x1", type: "postgres", planID: "mystery-g2", hostname: "h", status: "RUNNING", scale: 1 } }).database;
    const bad = toOverviewDto(detail, { hostname: "h", plan: unpriced("mystery-g2", 1, 1) });
    expect(bad.plan).toBeDefined();
    expect(bad.plan).not.toHaveProperty("pricePerMonth");
    const ok = toOverviewDto(detail, { hostname: "h", plan: plan("small-g2", 1, 1, 100) });
    expect(ok.plan?.pricePerMonth).toBe(72000);
  });
});

describe("app settings resize comparison", () => {
  it("an unpriced target or current plan gives no delta", () => {
    const [bad, good] = toPlanOptions([unpriced("mystery-g2", 2, 2), plan("small-g2", 1, 1, 100)]);
    expect(bad).toMatchObject({ priceKnown: false });
    expect(bad).not.toHaveProperty("pricePerHour");
    expect(comparePlansApp(good, undefined, bad)).toMatchObject({ direction: "unknown" });
    expect(comparePlansApp(good, undefined, bad).deltaMonthly).toBeUndefined();
    expect(comparePlansApp(bad, undefined, good).deltaMonthly).toBeUndefined();
  });
});

describe("create wizard plan DTO", () => {
  it("a zero price on a non-free plan is unknown, the free plan keeps 0", () => {
    const me = MeSchema.parse({
      plans: {
        projects: {
          free: { available: true, region: "iran", price: 0 },
          "zero-g2": { available: true, region: "iran", price: 0 },
          "ok-g2": { available: true, region: "iran", price: 10 },
        },
      },
    });
    const out = normalizePlans({ me });
    expect(out.appPlans.find((p) => p.id === "free")).toMatchObject({ hourlyToman: 0 });
    expect(out.appPlans.find((p) => p.id === "zero-g2")).not.toHaveProperty("hourlyToman");
    expect(out.appPlans.find((p) => p.id === "ok-g2")).toMatchObject({ hourlyToman: 10 });
  });
});
