import { describe, expect, it } from "vitest";
import { buildEnvChecklist, isGeneratable, wireMappingFor } from "@/lib/setup/env-plan";
import { recommendSetup, optionCost } from "@/lib/setup/recommend";
import { pickDbPlan, pickPlan, sizeNeeds } from "@/lib/setup/sizing";
import type { ProjectAnalysis } from "@/lib/setup/types";
import { analyzeFixture } from "./helpers";
import { APP_PLANS, DB_PLANS, SOURCES, plan } from "./plans";

const base = (over: Partial<ProjectAnalysis> = {}): ProjectAnalysis => ({
  platform: "node", confidence: 0.9, reasons: [], candidates: [], staticSite: false, hasDockerfile: false, requiresDatabase: [],
  envVarNames: [], secretsLikely: [], resourceHints: [], warnings: [], monorepoCandidates: [], stats: { fileCount: 1, totalBytes: 1 }, ...over,
});

describe("sizing heuristics", () => {
  it("orders platforms static < node < next/django/laravel/dotnet", () => {
    const ram = (p: Parameters<typeof sizeNeeds>[1]) => sizeNeeds(base(), p).ramGb;
    expect(ram("static")).toBeLessThan(ram("node"));
    expect(ram("node")).toBeLessThan(ram("next"));
    for (const p of ["django", "laravel", "dotnet"] as const) expect(ram(p)).toBeGreaterThanOrEqual(ram("next"));
    expect(ram("angular")).toBeGreaterThan(ram("react"));
  });

  it("adds memory for ORMs, headless browsers and large projects, with reasons", () => {
    const n = sizeNeeds(base({ resourceHints: ["orm", "headless_browser"], warnings: ["large_size"] }), "next");
    expect(n.ramGb).toBe(1 + 0.5 + 1.5 + 0.5);
    expect(n.reasons.map((r) => r.code)).toEqual(["need_base_next", "need_orm", "need_headless_browser", "need_large_project"]);
  });
});

describe("plan choice", () => {
  it("picks the cheapest plan that is big enough, with a smaller and a bigger alternative", () => {
    const pick = pickPlan(APP_PLANS, { ramGb: 1, cpu: 0.5 })!;
    expect(pick.chosen.id).toBe("medium-g2");
    expect(pick.smaller?.id).toBe("small-g2");
    expect(pick.bigger?.id).toBe("large-g2");
    expect(pick.belowNeed).toBe(false);
  });

  it("never picks an unavailable plan, and flags a need no plan can meet", () => {
    const pick = pickPlan(APP_PLANS, { ramGb: 6, cpu: 1 })!;
    expect(pick.belowNeed).toBe(true);
    expect(pick.chosen.id).toBe("xlarge-g2");
    expect(pick.bigger).toBeUndefined();
    expect(pick.reasons[0].code).toBe("plan_none_big_enough");
  });

  it("returns nothing when the account has no plan", () => {
    expect(pickPlan([], { ramGb: 1, cpu: 1 })).toBeUndefined();
  });

  it("db plans must support the engine and meet the engine minimum", () => {
    expect(pickDbPlan(DB_PLANS, "postgres")!.chosen.id).toBe("db-small-g2");
    expect(pickDbPlan(DB_PLANS, "mssql")!.chosen.id).toBe("db-medium-g2");
    expect(pickDbPlan([plan("only-redis", 1, 1, 10, { supports: ["redis"] })], "postgres")).toBeUndefined();
  });
});

describe("recommendSetup", () => {
  it("Next.js + postgres: plan, db, env checklist and cost totals add up", async () => {
    const a = await analyzeFixture("nextjs");
    const r = recommendSetup(a, SOURCES);
    expect(r.platform).toBe("next");
    expect(r.appPlan?.chosen.id).toBe("large-g2"); // next 1 + orm 0.5 -> 1.5 GB
    expect(r.port).toBe(3100);
    expect(r.deployMethod).toBe("upload");
    expect(r.db).toMatchObject({ engine: "postgres", version: "16" });
    expect(r.db?.plan?.chosen.id).toBe("db-small-g2");
    const app = r.costs.app!;
    const db = r.costs.db!;
    expect(app.perHourToman).toBe(4000);
    expect(app.perMonthToman).toBe(4000 * 720);
    expect(r.costs.totals.perHourToman).toBe(app.perHourToman + db.perHourToman);
    expect(r.costs.totals.perMonthToman).toBe(app.perMonthToman + db.perMonthToman);
    expect(r.domainSteps.length).toBeGreaterThan(3);
  });

  it("static projects get the smallest plan; unknown platform gets no plan and a note", async () => {
    const small = recommendSetup(base({ platform: "static", staticSite: true }), SOURCES);
    expect(small.appPlan?.chosen.id).toBe("small-g2");
    const unknown = recommendSetup(base({ platform: "unknown" }), SOURCES);
    expect(unknown.appPlan).toBeUndefined();
    expect(unknown.notes).toContain("platform_required");
    expect(recommendSetup(base({ platform: "unknown" }), SOURCES, "flask").platform).toBe("flask");
  });

  it("db suggestion degrades honestly when the account cannot create it", () => {
    const r = recommendSetup(base({ requiresDatabase: [{ engine: "elasticsearch", evidence: "x" }] }), SOURCES);
    expect(r.db?.unavailable).toBe("no_version");
    expect(r.costs.db).toBeUndefined();
    expect(r.notes).toContain("db_no_version");
  });

  it("only one database per plan; the others are listed", () => {
    const r = recommendSetup(base({ requiresDatabase: [{ engine: "postgres", evidence: "a" }, { engine: "redis", evidence: "b" }] }), SOURCES);
    expect(r.db?.engine).toBe("postgres");
    expect(r.db?.others).toEqual(["redis"]);
    expect(r.notes).toContain("one_database_only");
  });

  it("bundle plans add their monthly price to the cost", () => {
    const c = optionCost({ id: "x", pricePerHour: 2000, pricePerMonth: 1_440_000, bundles: [] }, 36_000);
    expect(c.perMonthToman).toBe(1_476_000);
    expect(Math.abs(c.perMonthToman - c.perHourToman * 720)).toBeLessThanOrEqual(1);
  });
});

describe("env checklist", () => {
  it("marks app-internal secrets as generated and everything else as user-provided; never invents values", () => {
    for (const n of ["SESSION_SECRET", "NEXTAUTH_SECRET", "JWT_SECRET", "SECRET_KEY", "DJANGO_SECRET_KEY", "APP_SECRET", "COOKIE_SECRET"]) expect(isGeneratable(n)).toBe(true);
    for (const n of ["APP_KEY", "STRIPE_SECRET_KEY", "GITHUB_CLIENT_SECRET", "DATABASE_URL", "SMTP_PASSWORD", "API_KEY", "OPENAI_API_KEY"]) expect(isGeneratable(n)).toBe(false);
    const items = buildEnvChecklist(["SESSION_SECRET", "APP_KEY", "STRIPE_SECRET_KEY", "PORT", "NODE_ENV", "DB_HOST", "DB_CONNECTION"], ["DB_HOST"]);
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(by.SESSION_SECRET).toMatchObject({ valueSource: "generated", generator: "hex32" });
    expect(by.APP_KEY).toMatchObject({ valueSource: "user", helpKey: "laravel_app_key" });
    expect(by.STRIPE_SECRET_KEY).toMatchObject({ valueSource: "user", secret: true });
    expect(by.DB_HOST.wired).toBe(true);
    expect(by.DB_CONNECTION.placeholder).toBe("mysql");
    expect(by.PORT).toBeUndefined();
    expect(by.NODE_ENV).toBeUndefined();
    expect(JSON.stringify(items)).not.toMatch(/"value"/);
  });

  it("user-provided items are listed first", () => {
    const items = buildEnvChecklist(["SESSION_SECRET", "ZZ_TOKEN"], []);
    expect(items.map((i) => i.name)).toEqual(["ZZ_TOKEN", "SESSION_SECRET"]);
  });
});

describe("db wiring keys", () => {
  it("uses the component keys a Laravel project declares", async () => {
    const a = await analyzeFixture("laravel");
    const w = wireMappingFor("mysql", a.envVarNames)!;
    expect(w.assumed).toBe(false);
    expect(w.mapping).toMatchObject({ host: "DB_HOST", port: "DB_PORT", user: "DB_USERNAME", password: "DB_PASSWORD", database: "DB_DATABASE" });
  });
  it("uses DATABASE_URL when only that is declared, and flags an assumed default", () => {
    expect(wireMappingFor("postgres", ["DATABASE_URL", "OTHER"])).toEqual({ mapping: { url: "DATABASE_URL" }, assumed: false });
    expect(wireMappingFor("postgres", [])).toEqual({ mapping: { url: "DATABASE_URL" }, assumed: true });
    expect(wireMappingFor("mongodb", [])?.mapping).toEqual({ url: "MONGODB_URI" });
    expect(wireMappingFor("redis", ["REDIS_URL"])?.mapping).toEqual({ url: "REDIS_URL" });
  });
  it("engines without a wiring convention get none", () => {
    expect(wireMappingFor("elasticsearch", [])).toBeUndefined();
  });
});
