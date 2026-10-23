// Setup UI honesty: unpriced bundles, incomplete totals, field-scoped catalog errors, and verification wording.
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChoicesForm } from "@/components/setup/choices-form";
import { ReviewStep } from "@/components/setup/review-step";
import { RunPanel } from "@/components/setup/run-panel";
import { fa } from "@/lib/i18n/fa";
import { bundleOptionLabel, hasUnpricedBundle } from "@/lib/setup/cost-view";
import { toCatalogView } from "@/lib/setup/catalog";
import { buildDeployPlan } from "@/lib/setup/plan";
import { explainPlanParts } from "@/lib/setup/explain";
import { draftFromRecommendation } from "@/lib/setup/draft";
import { initialRun, reduceRun } from "@/lib/setup/run-state";
import { recommendSetup } from "@/lib/setup/recommend";
import { errorText } from "@/lib/setup/text";
import { analyzeFixture } from "./helpers";
import { APP_PLANS, DB_PLANS, DB_VERSIONS, NETWORKS, SOURCES, plan } from "./plans";

const noop = () => undefined;
const mystery = plan("medium-g2", 1, 1, 2000, { bundles: [{ id: "mystery", available: true, monthlyPrice: undefined }, { id: "standard", available: true, monthlyPrice: 36000 }] });
const plans = [APP_PLANS[0], mystery, ...APP_PLANS.slice(2)];
const catalog = toCatalogView({ appPlans: plans, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS, networks: NETWORKS });

async function fixtureDraft(c = catalog) {
  const analysis = await analyzeFixture("nextjs");
  const rec = recommendSetup(analysis, SOURCES);
  return { analysis, rec, draft: draftFromRecommendation(analysis, rec, c, "shop.zip") };
}

describe("setup errors", () => {
  it("networks_unavailable and bundle_price_unknown have their own Persian copy (not the generic fallback)", () => {
    for (const code of ["networks_unavailable", "bundle_price_unknown"] as const) {
      expect(fa.setupFlow.errors[code]).toMatch(/[؀-ۿ]/);
      expect(errorText(code)).not.toBe(fa.setupFlow.errors.generic);
    }
  });
});

describe("unpriced bundles", () => {
  it("labels an unpriced bundle «قیمت نامشخص» and a priced one with its price", () => {
    expect(bundleOptionLabel({ id: "mystery", priceKnown: false })).toContain("قیمت نامشخص");
    expect(bundleOptionLabel({ id: "standard", monthlyPrice: 36000, priceKnown: true })).toContain("۳۶٬۰۰۰");
    expect(hasUnpricedBundle(catalog.appPlans, "medium-g2", "mystery")).toBe(true);
    expect(hasUnpricedBundle(catalog.appPlans, "medium-g2", "standard")).toBe(false);
    expect(hasUnpricedBundle(catalog.appPlans, "medium-g2", "")).toBe(false);
  });

  it("choices form shows the hint for an unpriced bundle and the bundle error with a retry after bundle_price_unknown", async () => {
    const { rec, draft } = await fixtureDraft();
    const base = { catalog, rec, hasSource: true, showProblems: false, onChange: noop };
    const withHint = renderToString(h(ChoicesForm, { ...base, draft: { ...draft, planId: "medium-g2" } }));
    expect(withHint).toContain(fa.setupFlow.choices.bundleUnpricedHint);
    const failed = renderToString(h(ChoicesForm, { ...base, draft: { ...draft, planId: "medium-g2", bundlePlanId: "mystery" }, planError: { code: "bundle_price_unknown", field: "bundlePlanId" }, onRetryCatalog: noop }));
    expect(failed).toContain(fa.setupFlow.errors.bundle_price_unknown);
    expect(failed).toContain(fa.common.retry);
  });

  it("shows the networks error next to the network field with a retry (not as an empty list)", async () => {
    const failedCatalog = toCatalogView({ appPlans: plans, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS, networks: [], networksError: true });
    const { rec, draft } = await fixtureDraft(failedCatalog);
    const html = renderToString(h(ChoicesForm, { draft, catalog: failedCatalog, rec, hasSource: true, showProblems: false, onChange: noop, onRetryCatalog: noop }));
    expect(html).toContain(fa.setupFlow.errors.networks_unavailable);
    expect(html).toContain(fa.common.retry);
    const viaPlan = renderToString(h(ChoicesForm, { draft, catalog, rec, hasSource: true, showProblems: false, planError: { code: "networks_unavailable", field: "networkId" }, onChange: noop, onRetryCatalog: noop }));
    expect(viaPlan).toContain(fa.setupFlow.errors.networks_unavailable);
  });
});

describe("review total", () => {
  it("says the total is incomplete («حداقل») when a billed component is unpriced, and not otherwise", async () => {
    const { analysis, draft } = await fixtureDraft();
    const built = buildDeployPlan(analysis, { appName: "my-shop", planId: "large-g2", envChoices: [], dockerImage: "nginx" }, { appPlans: APP_PLANS, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS, networks: NETWORKS });
    if (!built.ok) throw new Error(built.code);
    const planResponse = { proposalId: "p_1", plan: built.plan, costs: built.costs, explanation: explainPlanParts(built.plan), userValueKeys: [], expiresAt: new Date(Date.now() + 600_000).toISOString() };
    const props = { plan: planResponse, draft, expired: false, onBack: noop, onConfirm: noop };
    const incomplete = renderToString(h(ReviewStep, { ...props, costIncomplete: true }));
    expect(incomplete).toContain("حداقل");
    expect(incomplete).toContain("بخشی از قیمت‌ها نامشخص است");
    const complete = renderToString(h(ReviewStep, props));
    expect(complete).not.toContain("حداقل");
    expect(complete).not.toContain("نامشخص");
  });
});

describe("run panel verification wording", () => {
  const threeSteps = async () => {
    const analysis = await analyzeFixture("nextjs");
    const built = buildDeployPlan(analysis, { appName: "my-shop", planId: "large-g2", envChoices: [], dockerImage: "nginx" }, { appPlans: APP_PLANS, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS, networks: NETWORKS });
    if (!built.ok) throw new Error(built.code);
    let run = reduceRun(initialRun, { kind: "phase", phase: "executing" });
    for (const s of built.plan.steps) run = reduceRun(run, { kind: "step", step: s.id, status: "done" });
    return { plan: built.plan, run };
  };

  it("unknown is amber «قابل اثبات نیست», skipped is grey «بررسی نشد», only failed is red; headline stays neutral", async () => {
    const { plan: p, run } = await threeSteps();
    const done = reduceRun(run, {
      kind: "verification",
      result: {
        outcome: "not_verified",
        checks: [
          { name: "app_running", passed: true, status: "passed", detail: "" },
          { name: "http_probe", passed: false, status: "unknown", detail: "" },
          { name: "domain_dns", passed: false, status: "skipped", detail: "" },
          { name: "ssl", passed: false, status: "failed", detail: "" },
        ],
      },
    });
    const html = renderToString(h(RunPanel, { plan: p, run: done, onRestart: noop }));
    const row = (name: string) => html.split("<li").find((l) => l.includes(`>${name}</bdi>`)) ?? "";
    expect(row("http_probe")).toContain("قابل اثبات نیست");
    expect(row("http_probe")).toContain("text-warn");
    expect(row("http_probe")).not.toContain("text-danger");
    expect(row("domain_dns")).toContain("بررسی نشد");
    expect(row("domain_dns")).not.toContain("text-danger");
    expect(row("ssl")).toContain("text-danger");
    expect(row("app_running")).toContain("text-ok");
    expect(html).toContain("راه‌اندازی انجام شد");
    expect(html).not.toContain(fa.setupFlow.run.verified);
    expect(html).not.toContain("مشکل برطرف شد");
  });

  it("a «verified» outcome with no passed check is not shown as success", async () => {
    const { plan: p, run } = await threeSteps();
    const done = reduceRun(run, { kind: "verification", result: { outcome: "verified", checks: [{ name: "x", passed: false, status: "unknown", detail: "" }] } });
    const html = renderToString(h(RunPanel, { plan: p, run: done, onRestart: noop }));
    expect(html).not.toContain(fa.setupFlow.run.verified);
    expect(html).toContain(fa.setupFlow.run.not_verified);
  });

  it("failed steps never read as executed", async () => {
    const { plan: p, run } = await threeSteps();
    const failed = reduceRun(reduceRun(run, { kind: "step", step: p.steps[0].id, status: "failed" }), { kind: "status", status: "failed" });
    const html = renderToString(h(RunPanel, { plan: p, run: failed, onRestart: noop }));
    expect(html).toContain(fa.setupFlow.run.notExecutedTitle);
    expect(html).not.toContain(fa.setupFlow.run.executedTitle);
  });
});
