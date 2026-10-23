// Rule-based Persian explanation of a DeployPlan. This is the seam where an LLM could later rephrase the text;
// until then the wording is fixed by setupFlow strings, so it can never promise more than the plan does.
import { userValueKeysOf, type DeployPlan, type DeployPlanStep } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { faNumber, faPlain } from "@/lib/i18n/format";
import { DOMAIN_STEPS } from "./recommend";
import { domainStepText, engineName, platformName } from "./text";

const S = fa.setupFlow;

/** Numbers get Persian digits like the rest of the copy («تنظیم ۱ متغیر»); a port is an identifier, so never grouped. */
const fill = (template: string, params: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = params[k];
    if (typeof v === "number") return k === "port" ? faPlain(v) : faNumber(v);
    return v ?? "";
  });

export interface PlanExplanation {
  summary: string;
  steps: string[];
  domain: string[];
  notes: string[];
}

export function stepLabel(step: DeployPlanStep): string {
  switch (step.kind) {
    case "create_app":
      return fill(S.steps.create_app, { name: step.name, platform: platformName(step.platform), plan: step.planId });
    case "create_db":
      return fill(S.steps.create_db, { name: step.name, engine: engineName(step.engine), plan: step.planId });
    case "set_env": {
      const user = userValueKeysOf(step.changes).length;
      const generated = step.changes.length - user;
      const parts = [fill(S.steps.set_env, { count: step.changes.length })];
      if (user > 0) parts.push(fill(S.steps.set_env_user, { count: user }));
      if (generated > 0) parts.push(fill(S.steps.set_env_generated, { count: generated }));
      return `${parts[0]} (${parts.slice(1).join("؛ ")})`;
    }
    case "wire_db":
      return fill(S.steps.wire_db, { keys: Object.values(step.mapping).join("، ") });
    case "deploy":
      return step.source.kind === "upload"
        ? fill(S.steps.deploy_upload, { port: step.port })
        : fill(S.steps.deploy_image, { image: step.source.image, port: step.port });
    case "domain_guidance":
      return step.domain ? fill(S.steps.domain_guidance_for, { domain: step.domain }) : S.steps.domain_guidance;
  }
}

export function explainPlanParts(plan: DeployPlan): PlanExplanation {
  const app = plan.steps.find((s) => s.kind === "create_app");
  const db = plan.steps.find((s) => s.kind === "create_db");
  const deploy = plan.steps.find((s) => s.kind === "deploy");
  const env = plan.steps.find((s) => s.kind === "set_env");

  const deployText = deploy?.source.kind === "image" ? S.explain.deployImage : S.explain.deployUpload;
  let summary = app
    ? fill(S.explain.summary, { platform: platformName(app.platform), app: app.name, plan: app.planId, deploy: deployText })
    : "";
  if (db) summary += ` ${fill(S.explain.summaryDb, { engine: engineName(db.engine) })}`;

  const notes: string[] = [
    fill(S.explain.cost, { month: faNumber(Math.round(plan.totals.perMonthToman)), hour: faNumber(Math.round(plan.totals.perHourToman)) }),
  ];
  if (plan.network) notes.push(fill(S.explain.network, { network: plan.network }));
  if (env) {
    const user = userValueKeysOf(env.changes).length;
    if (user > 0) notes.push(fill(S.explain.envUser, { count: user }));
    if (env.changes.length - user > 0) notes.push(fill(S.explain.envGenerated, { count: env.changes.length - user }));
  }
  notes.push(S.explain.domain, S.explain.approval);

  return {
    summary: summary.trim(),
    steps: plan.steps.map(stepLabel),
    domain: DOMAIN_STEPS.map(domainStepText),
    notes,
  };
}

/** Plain-text form (summary, numbered steps, notes) for places that cannot render structure. */
export function explainPlan(plan: DeployPlan): string {
  const p = explainPlanParts(plan);
  return [p.summary, ...p.steps.map((s, i) => `${i + 1}. ${s}`), ...p.notes].join("\n");
}
