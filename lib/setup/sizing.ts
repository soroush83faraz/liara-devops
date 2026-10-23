// Deterministic plan sizing: platform baseline + adjusters from detected dependencies. Every number below is a
// planning heuristic (not a Liara guarantee) and is shown to the user as a reason, never as a fact.
import type { DbEngine, Platform } from "@/lib/contracts";
import type { NormalizedPlan } from "@/lib/liara/account";
import type { ProjectAnalysis, Reason } from "./types";

export interface Needs {
  ramGb: number;
  cpu: number;
  reasons: Reason[];
}

const BASE: Record<Platform, { ram: number; cpu: number }> = {
  static: { ram: 0.25, cpu: 0.25 },
  react: { ram: 0.5, cpu: 0.25 },
  vue: { ram: 0.5, cpu: 0.25 },
  angular: { ram: 1, cpu: 0.25 },
  go: { ram: 0.25, cpu: 0.25 },
  node: { ram: 0.5, cpu: 0.25 },
  flask: { ram: 0.5, cpu: 0.25 },
  python: { ram: 0.5, cpu: 0.25 },
  php: { ram: 0.5, cpu: 0.25 },
  docker: { ram: 0.5, cpu: 0.25 },
  next: { ram: 1, cpu: 0.5 },
  django: { ram: 1, cpu: 0.5 },
  laravel: { ram: 1, cpu: 0.5 },
  dotnet: { ram: 1, cpu: 0.5 },
};

/** Default container port per platform when nothing was detected. [VAL] against Liara's platform docs. */
const DEFAULT_PORT: Record<Platform, number> = {
  node: 3000, next: 3000, react: 80, vue: 80, angular: 80, static: 80, django: 8000, flask: 5000, python: 8000,
  laravel: 80, php: 80, dotnet: 80, go: 8080, docker: 80,
};

export const defaultPortFor = (p: Platform): number => DEFAULT_PORT[p];

const ADJUST: Record<string, { ram: number; code: string; appliesTo?: ReadonlySet<Platform> }> = {
  orm: { ram: 0.5, code: "need_orm", appliesTo: new Set<Platform>(["node", "next", "django", "laravel", "dotnet", "flask", "python", "docker"]) },
  image_processing: { ram: 0.5, code: "need_image_processing" },
  headless_browser: { ram: 1.5, code: "need_headless_browser" },
  ml_libs: { ram: 2, code: "need_ml_libs" },
};

export function sizeNeeds(analysis: ProjectAnalysis, platform: Platform): Needs {
  const base = BASE[platform];
  const reasons: Reason[] = [{ code: `need_base_${platform}` }];
  let ram = base.ram;
  for (const hint of analysis.resourceHints) {
    const adj = ADJUST[hint];
    if (!adj || (adj.appliesTo && !adj.appliesTo.has(platform))) continue;
    ram += adj.ram;
    reasons.push({ code: adj.code });
  }
  if (analysis.warnings.includes("large_size")) {
    ram += 0.5;
    reasons.push({ code: "need_large_project" });
  }
  return { ramGb: ram, cpu: base.cpu, reasons };
}

export interface PlanOption {
  id: string;
  ramGb?: number;
  cpu?: number;
  diskGb?: number;
  pricePerHour: number;
  pricePerMonth: number;
  bundles: Array<{ id: string; monthlyPrice?: number; priceKnown?: boolean }>;
}

export const toOption = (p: NormalizedPlan): PlanOption => ({
  id: p.id,
  ramGb: p.ramGb,
  cpu: p.cpu,
  diskGb: p.diskGb,
  pricePerHour: p.pricePerHour,
  pricePerMonth: Math.round(p.pricePerHour * 720),
  // priceKnown:false => the UI must show «قیمت نامشخص», never a free bundle (plan building refuses it).
  bundles: p.bundles.filter((b) => b.available).map((b) => ({ id: b.id, monthlyPrice: b.monthlyPrice, priceKnown: typeof b.monthlyPrice === "number" })),
});

/** A plan can be recommended/costed only with a price from Liara; an unpriced plan is skipped, never treated as free. */
const priced = (p: NormalizedPlan) => p.available && p.priceKnown;

const byPrice = (a: NormalizedPlan, b: NormalizedPlan) => a.pricePerHour - b.pricePerHour || (a.ramGb ?? 0) - (b.ramGb ?? 0) || a.id.localeCompare(b.id);

export interface PlanPick {
  chosen: PlanOption;
  smaller?: PlanOption;
  bigger?: PlanOption;
  /** True when no plan met the need and the largest one was taken. */
  belowNeed: boolean;
  reasons: Reason[];
}

export function pickPlan(plans: readonly NormalizedPlan[], need: { ramGb: number; cpu: number }): PlanPick | undefined {
  const sorted = plans.filter(priced).sort(byPrice);
  if (sorted.length === 0) return undefined;
  const fits = (p: NormalizedPlan) => (p.ramGb === undefined || p.ramGb >= need.ramGb) && (p.cpu === undefined || p.cpu >= need.cpu);
  let i = sorted.findIndex(fits);
  const belowNeed = i === -1;
  if (belowNeed) i = sorted.length - 1;
  const reasons: Reason[] = [{ code: belowNeed ? "plan_none_big_enough" : i === 0 ? "plan_cheapest_fits" : "plan_smallest_sufficient" }];
  if (sorted[i].ramGb === undefined) reasons.push({ code: "plan_size_unknown" });
  return {
    chosen: toOption(sorted[i]),
    smaller: i > 0 ? toOption(sorted[i - 1]) : undefined,
    bigger: i < sorted.length - 1 ? toOption(sorted[i + 1]) : undefined,
    belowNeed,
    reasons,
  };
}

const DB_MIN_RAM: Partial<Record<DbEngine, number>> = { mssql: 2, elasticsearch: 2, clickhouse: 2, mongodb: 0.5, postgres: 0.5, mysql: 0.5, mariadb: 0.5, redis: 0.25, rabbitmq: 0.5 };

export function pickDbPlan(plans: readonly NormalizedPlan[], engine: DbEngine): PlanPick | undefined {
  const supporting = plans.filter((p) => !p.supports || p.supports.includes(engine));
  const pick = pickPlan(supporting, { ramGb: DB_MIN_RAM[engine] ?? 0.5, cpu: 0 });
  if (pick) pick.reasons.unshift({ code: "db_min_ram", detail: engine });
  return pick;
}
