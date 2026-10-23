import { describe, expect, it } from "vitest";
import { PlanBodySchema } from "@/lib/setup/plan-request";
import { handleStreamMessage, type RunEvent } from "@/lib/setup/client";
import {
  activeEnvRows,
  collectUserValues,
  draftFromRecommendation,
  draftProblems,
  draftToChoices,
  missingUserValues,
  slugifyAppName,
} from "@/lib/setup/draft";
import { recommendSetup } from "@/lib/setup/recommend";
import { initialRun, reduceRun } from "@/lib/setup/run-state";
import { toCatalogView } from "@/lib/setup/catalog";
import { analyzeFixture } from "./helpers";
import { APP_PLANS, DB_PLANS, DB_VERSIONS, NETWORKS, SOURCES } from "./plans";

const catalog = toCatalogView({ appPlans: APP_PLANS, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS, networks: NETWORKS });

async function draftFor(name: string) {
  const a = await analyzeFixture(name);
  const rec = recommendSetup(a, SOURCES);
  return draftFromRecommendation(a, rec, catalog, `${name}.zip`);
}

describe("slugifyAppName", () => {
  it("makes a valid Liara app name from a file name", () => {
    expect(slugifyAppName("My Shop (final).zip")).toBe("my-shop-final");
    expect(slugifyAppName("پروژه.zip")).toBe("my-app");
    expect(slugifyAppName("a".repeat(100) + ".tar.gz").length).toBeLessThanOrEqual(40);
    expect(slugifyAppName("")).toBe("my-app");
  });
});

describe("draft", () => {
  it("starts from the recommendation and survives the request schema", async () => {
    const d = await draftFor("nextjs");
    expect(d).toMatchObject({ appName: "nextjs", platform: "next", planId: "large-g2", includeDb: true, dbEngine: "postgres", dbPlanId: "db-small-g2", port: "3100" });
    expect(draftProblems(d, true)).toEqual([]);
    const choices = draftToChoices(d);
    expect(PlanBodySchema.safeParse({ sourceRef: "abc", choices }).success).toBe(true);
    expect(choices.dbEnvKeys).toEqual({ url: "DATABASE_URL" });
  });

  it("flags obvious problems before any request", async () => {
    const d = await draftFor("nextjs");
    expect(draftProblems({ ...d, appName: "Bad Name" }, true)).toContain("appName");
    expect(draftProblems({ ...d, planId: "" }, true)).toContain("plan");
    expect(draftProblems({ ...d, port: "99999" }, true)).toContain("port");
    expect(draftProblems(d, false)).toContain("deploySource");
    expect(draftProblems({ ...d, dockerImage: "x/y:1" }, false)).not.toContain("deploySource");
    expect(draftProblems({ ...d, platform: "" }, true)).toContain("platform");
  });

  it("an unknown platform leaves the platform empty so the user must choose", async () => {
    const d = await draftFor("empty-unknown");
    expect(d.platform).toBe("");
    expect(d.planId).toBe("");
  });
});

describe("env values stay out of API bodies", () => {
  it("draftToChoices carries names and sources only; values leave only through collectUserValues for the plan's keys", async () => {
    const d = await draftFor("nextjs");
    const typed = { ...d, env: d.env.map((r) => (r.valueSource === "user" ? { ...r, value: `TYPED_SECRET_${r.name}` } : r)) };
    const body = JSON.stringify(PlanBodySchema.parse({ choices: draftToChoices(typed) }));
    expect(body).not.toContain("TYPED_SECRET");
    expect(missingUserValues(d).length).toBeGreaterThan(0);
    expect(missingUserValues(typed)).toEqual([]);
    const values = collectUserValues(typed, ["STRIPE_SECRET_KEY"]);
    expect(Object.keys(values)).toEqual(["STRIPE_SECRET_KEY"]);
    expect(values.STRIPE_SECRET_KEY).toBe("TYPED_SECRET_STRIPE_SECRET_KEY");
  });

  it("DB-wired and unticked rows are not active", async () => {
    const d = await draftFor("nextjs");
    expect(activeEnvRows(d).map((r) => r.name)).not.toContain("DATABASE_URL");
    expect(activeEnvRows({ ...d, includeDb: false }).map((r) => r.name)).toContain("DATABASE_URL");
    const off = { ...d, env: d.env.map((r) => (r.name === "STRIPE_SECRET_KEY" ? { ...r, include: false } : r)) };
    expect(draftToChoices(off).envChoices.map((c) => c.name)).not.toContain("STRIPE_SECRET_KEY");
  });
});

describe("execution progress", () => {
  const msg = (type: string, data: unknown) => JSON.stringify({ type, data });
  const collect = (raw: string) => {
    const events: RunEvent[] = [];
    const done = handleStreamMessage(raw, (e) => events.push(e));
    return { events, done };
  };

  it("maps contract stream events", () => {
    expect(collect(msg("data-execution", { proposalId: "p_1", step: "S1", status: "running" }))).toEqual({
      events: [{ kind: "step", step: "S1", status: "running", detail: undefined }],
      done: false,
    });
    const ver = collect(msg("data-verification", { proposalId: "p_1", result: { checks: [{ name: "app_running", passed: true, detail: "" }], outcome: "verified" } }));
    expect(ver.done).toBe(true);
    expect(ver.events[0].kind).toBe("verification");
    expect(collect(msg("data-error", { code: "boom", messageFa: "خطا" })).done).toBe(true);
    expect(collect("not json").events).toEqual([]);
    expect(collect(msg("data-execution", { nope: 1 })).events).toEqual([]);
  });

  it("reducer tracks plan steps, sub-steps, verification and errors", () => {
    let s = reduceRun(initialRun, { kind: "phase", phase: "executing" });
    s = reduceRun(s, { kind: "step", step: "S1", status: "done" });
    s = reduceRun(s, { kind: "step", step: "readback", status: "running" });
    s = reduceRun(s, { kind: "step", step: "readback", status: "done" });
    expect(s.steps.S1.status).toBe("done");
    expect(s.other).toEqual([{ step: "readback", status: "done", detail: undefined }]);
    expect(s.phase).toBe("executing");
    s = reduceRun(s, { kind: "error", code: "x", message: "m" });
    expect(s.phase).toBe("finished");
    expect(reduceRun(s, { kind: "reset" })).toEqual(initialRun);
    expect(reduceRun(initialRun, { kind: "status", status: "verified" }).phase).toBe("finished");
    expect(reduceRun(initialRun, { kind: "status", status: "executing" }).phase).toBe("idle");
  });
});
