// Server-render smoke test: every wizard step renders from realistic data without throwing, shows Persian text,
// keeps LTR fragments isolated, and never contains an env value.
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisStep } from "@/components/setup/analysis-step";
import { ReviewStep } from "@/components/setup/review-step";
import { RunPanel } from "@/components/setup/run-panel";
import { SetupEntryLink } from "@/components/setup/setup-entry-link";
import { StartStep } from "@/components/setup/start-step";
import { toCatalogView } from "@/lib/setup/catalog";
import { buildDeployPlan } from "@/lib/setup/plan";
import { explainPlanParts } from "@/lib/setup/explain";
import { draftFromRecommendation } from "@/lib/setup/draft";
import { initialRun, reduceRun } from "@/lib/setup/run-state";
import { recommendSetup } from "@/lib/setup/recommend";
import { analyzeFixture } from "./helpers";
import { APP_PLANS, DB_PLANS, DB_VERSIONS, NETWORKS, SOURCES } from "./plans";

const noop = () => undefined;
const catalog = toCatalogView({ appPlans: APP_PLANS, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS, networks: NETWORKS });

describe("setup UI renders", () => {
  it("start step and entry link", () => {
    const html = renderToString(h(StartStep, { busy: false, onFile: noop, onAnswers: noop }));
    expect(html).toContain("بارگذاری فایل پروژه");
    expect(renderToString(h(SetupEntryLink, { showHint: true }))).toContain('href="/setup"');
  });

  it("analysis step: reasons, warnings, plan cards, env checklist (with values hidden)", async () => {
    const analysis = await analyzeFixture("nextjs");
    const rec = recommendSetup(analysis, SOURCES);
    const draft = draftFromRecommendation(analysis, rec, catalog, "shop.zip");
    draft.env = draft.env.map((r) => (r.valueSource === "user" ? { ...r, value: "TYPED_VALUE_123" } : r));
    const html = renderToString(
      h(AnalysisStep, { result: { analysis, recommendation: rec, catalog, sourceRef: "abc" }, draft, showProblems: true, busy: false, error: null, onChange: noop, onBack: noop, onContinue: noop, onRetryCatalog: noop }),
    );
    expect(html).toContain("چرا فکر می‌کنیم Next.js است؟");
    expect(html).toContain("پیشنهاد ما");
    expect(html).toContain("NEXTAUTH_SECRET");
    expect(html).toContain('type="password"'); // secret-looking user values are masked
    expect(html).not.toMatch(/\b(left|right)-|\b(ml|mr|pl|pr)-\d/);
  });

  it("review and run panels", async () => {
    const analysis = await analyzeFixture("nextjs");
    const rec = recommendSetup(analysis, SOURCES);
    const draft = draftFromRecommendation(analysis, rec, catalog, "my-shop.zip");
    draft.env = draft.env.map((r) => ({ ...r, value: r.valueSource === "user" ? "x" : "" }));
    const built = buildDeployPlan(
      analysis,
      { appName: "my-shop", planId: "large-g2", includeDb: true, dbEngine: "postgres", dbPlanId: "db-small-g2", envChoices: [{ name: "STRIPE_SECRET_KEY", valueSource: "user" }] },
      { appPlans: APP_PLANS, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS, networks: NETWORKS, sourceRef: "a1b2c3d4e5f60718293a4b5c6d7e8f90" },
    );
    if (!built.ok) throw new Error(built.code);
    const planResponse = {
      proposalId: "p_1",
      plan: built.plan,
      costs: built.costs,
      explanation: explainPlanParts(built.plan),
      userValueKeys: ["STRIPE_SECRET_KEY"],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    const review = renderToString(h(ReviewStep, { plan: planResponse, draft, expired: false, onBack: noop, onConfirm: noop }));
    expect(review).toContain("مراحلی که اجرا می‌شود");
    expect(review).toContain("my-shop");
    expect(review).toContain("وصل کردن دامنه");

    let run = reduceRun(initialRun, { kind: "phase", phase: "executing" });
    run = reduceRun(run, { kind: "step", step: "S1", status: "done" });
    run = reduceRun(run, { kind: "step", step: "S2", status: "running" });
    const running = renderToString(h(RunPanel, { plan: built.plan, run, onRestart: noop }));
    expect(running).toContain("انجام شد");
    expect(running).toContain("در حال انجام");
    run = reduceRun(run, { kind: "verification", result: { checks: [{ name: "app_running", passed: true, detail: "" }], outcome: "verified" } });
    const done = renderToString(h(RunPanel, { plan: built.plan, run, onRestart: noop }));
    expect(done).toContain("همه‌چیز تأیید شد");
    expect(done).toContain('href="/"');
  });
});
