// Deterministic plan recommender: ProjectAnalysis + the user's real plans -> a costed recommendation.
// No LLM here. Every choice carries machine-readable reasons that setupFlow strings turn into Persian.
import { costFromHourly, type Cost, type DbEngine, type Platform } from "@/lib/contracts";
import type { DbVersions, NormalizedPlan } from "@/lib/liara/account";
import { buildEnvChecklist, wireMappingFor, type EnvChecklistItem } from "./env-plan";
import { defaultPortFor, pickDbPlan, pickPlan, sizeNeeds, type PlanOption, type PlanPick } from "./sizing";
import type { PortSource, ProjectAnalysis, Reason } from "./types";
import type { WireMapping } from "@/lib/contracts";

export interface PlanSources {
  appPlans: readonly NormalizedPlan[];
  dbPlans: readonly NormalizedPlan[];
  dbVersions: readonly DbVersions[];
}

export interface DbSuggestion {
  engine: DbEngine;
  evidence: string;
  version?: string;
  plan?: PlanPick;
  /** Why no database could be suggested (no version / no plan for this engine). */
  unavailable?: "no_version" | "no_plan";
  wire: { mapping: WireMapping; assumed: boolean } | undefined;
  /** Other engines the project mentions (one database is added per plan). */
  others: DbEngine[];
}

export interface Recommendation {
  platform: Platform | undefined;
  needs: { ramGb: number; cpu: number; reasons: Reason[] };
  appPlan?: PlanPick;
  port: number;
  portSource: PortSource;
  deployMethod: "upload" | "image";
  db?: DbSuggestion;
  env: EnvChecklistItem[];
  domainSteps: string[];
  costs: { app?: Cost; db?: Cost; totals: Cost };
  notes: string[];
}

export const DOMAIN_STEPS = ["add_domain", "create_dns_record", "wait_dns", "check_domain", "ssl", "irnic"] as const;

export const optionCost = (p: PlanOption, bundleMonthly = 0): Cost => {
  if (bundleMonthly === 0) return costFromHourly(p.pricePerHour);
  const perMonthToman = Math.round(p.pricePerHour * 720 + bundleMonthly);
  return { perHourToman: perMonthToman / 720, perMonthToman };
};

export function addCosts(...cs: Array<Cost | undefined>): Cost {
  let h = 0;
  let m = 0;
  for (const c of cs) {
    if (!c) continue;
    h += c.perHourToman;
    m += c.perMonthToman;
  }
  return { perHourToman: h, perMonthToman: m };
}

function suggestDb(analysis: ProjectAnalysis, src: PlanSources): DbSuggestion | undefined {
  const first = analysis.requiresDatabase[0];
  if (!first) return undefined;
  const versions = src.dbVersions.find((v) => v.engine === first.engine);
  const version = versions?.defaultVersion ?? versions?.versions[0]?.value;
  const plan = pickDbPlan(src.dbPlans, first.engine);
  const wire = wireMappingFor(first.engine, analysis.envVarNames);
  return {
    engine: first.engine,
    evidence: first.evidence,
    version,
    plan,
    unavailable: !version ? "no_version" : !plan ? "no_plan" : undefined,
    wire,
    others: analysis.requiresDatabase.slice(1).map((d) => d.engine),
  };
}

export function recommendSetup(analysis: ProjectAnalysis, src: PlanSources, platformOverride?: Platform): Recommendation {
  const platform = platformOverride ?? (analysis.platform === "unknown" ? undefined : analysis.platform);
  const notes: string[] = [];
  const db = suggestDb(analysis, src);
  const wiredKeys = db?.wire ? Object.values(db.wire.mapping).filter((k): k is string => typeof k === "string") : [];
  const env = buildEnvChecklist(analysis.envVarNames, wiredKeys);

  if (!platform) {
    return {
      platform,
      needs: { ramGb: 0, cpu: 0, reasons: [] },
      port: 80,
      portSource: "default",
      deployMethod: "upload",
      db,
      env,
      domainSteps: [...DOMAIN_STEPS],
      costs: { totals: addCosts() },
      notes: ["platform_required"],
    };
  }

  const needs = sizeNeeds(analysis, platform);
  const appPlan = pickPlan(src.appPlans, needs);
  if (!appPlan) notes.push("no_app_plans");
  if (appPlan?.belowNeed) notes.push("plan_below_need");
  if (db?.others.length) notes.push("one_database_only");
  if (db?.unavailable) notes.push(`db_${db.unavailable}`);
  if (db?.wire?.assumed) notes.push("wire_key_assumed");

  const usable = db && !db.unavailable && db.plan;
  const appCost = appPlan ? optionCost(appPlan.chosen) : undefined;
  const dbCost = usable ? optionCost(db.plan!.chosen) : undefined;
  return {
    platform,
    needs: { ramGb: needs.ramGb, cpu: needs.cpu, reasons: needs.reasons },
    appPlan,
    port: analysis.port ?? defaultPortFor(platform),
    portSource: analysis.port ? (analysis.portSource ?? "code") : "default",
    deployMethod: "upload",
    db,
    env,
    domainSteps: [...DOMAIN_STEPS],
    costs: { app: appCost, db: dbCost, totals: addCosts(appCost, dbCost) },
    notes,
  };
}
