// The wizard's editable state and its conversion to API bodies. PURE (no I/O) so it is unit-tested.
// Env VALUES live in `EnvRow.value` and are only ever read by `collectUserValues()` at execute time.
import { AppNameSchema, DB_ENGINES, type DbEngine, type Platform } from "@/lib/contracts";
import type { CatalogView } from "./catalog";
import { ENV_NAME_RE } from "./env-names";
import type { Recommendation } from "./recommend";
import type { PlanBody } from "./plan-request";
import type { ProjectAnalysis } from "./types";

export interface EnvRow {
  name: string;
  include: boolean;
  valueSource: "user" | "generated";
  /** What the user typed. Component state only; never put into API bodies except via collectUserValues(). */
  value: string;
  secret: boolean;
  wired: boolean;
  helpKey?: string;
  placeholder?: string;
  extra: boolean;
}

export interface Draft {
  appName: string;
  platform: Platform | "";
  planId: string;
  bundlePlanId: string;
  port: string;
  networkId: string;
  includeDb: boolean;
  dbEngine: DbEngine | "";
  dbPlanId: string;
  dbName: string;
  dbEnvKeys: Record<string, string>;
  dockerImage: string;
  domain: string;
  env: EnvRow[];
}

export function slugifyAppName(raw: string): string {
  const stem = raw.replace(/\.(zip|tar\.gz|tgz)$/i, "");
  const s = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return AppNameSchema.safeParse(s).success ? s : "my-app";
}

export function draftFromRecommendation(
  analysis: ProjectAnalysis,
  rec: Recommendation | undefined,
  catalog: CatalogView | undefined,
  fileName?: string,
): Draft {
  const dbUsable = !!rec?.db && !rec.db.unavailable && !!rec.db.plan;
  return {
    appName: analysis.liaraJson?.app ?? slugifyAppName(fileName ?? ""),
    platform: rec?.platform ?? (analysis.platform === "unknown" ? "" : analysis.platform),
    planId: rec?.appPlan?.chosen.id ?? "",
    bundlePlanId: "",
    port: String(rec?.port ?? analysis.port ?? ""),
    networkId: "",
    includeDb: dbUsable,
    dbEngine: rec?.db?.engine ?? "",
    dbPlanId: rec?.db?.plan?.chosen.id ?? "",
    dbName: "",
    dbEnvKeys: rec?.db?.wire ? Object.fromEntries(Object.entries(rec.db.wire.mapping).filter((e): e is [string, string] => typeof e[1] === "string")) : {},
    dockerImage: "",
    domain: "",
    env: (rec?.env ?? []).map((i) => ({
      name: i.name,
      include: true,
      valueSource: i.valueSource,
      value: "",
      secret: i.secret,
      wired: !!i.wired,
      helpKey: i.helpKey,
      placeholder: i.placeholder,
      extra: false,
    })),
  };
}

/** Which env rows end up in the plan, given the current DB wiring. */
export function activeEnvRows(d: Draft): EnvRow[] {
  const wired = new Set(d.includeDb ? Object.values(d.dbEnvKeys) : []);
  return d.env.filter((r) => r.include && !wired.has(r.name));
}

export function draftToChoices(d: Draft): PlanBody["choices"] {
  const port = d.port.trim() === "" ? undefined : Number(d.port);
  const dbKeys = Object.entries(d.dbEnvKeys).filter(([, v]) => v.trim() !== "");
  return {
    appName: d.appName.trim(),
    platform: d.platform === "" ? undefined : d.platform,
    networkId: d.networkId || undefined,
    planId: d.planId || undefined,
    bundlePlanId: d.bundlePlanId || undefined,
    includeDb: d.includeDb || undefined,
    dbEngine: d.includeDb && d.dbEngine ? d.dbEngine : undefined,
    dbPlanId: d.includeDb && d.dbPlanId ? d.dbPlanId : undefined,
    dbName: d.includeDb && d.dbName.trim() ? d.dbName.trim() : undefined,
    dbEnvKeys: d.includeDb && dbKeys.length > 0 ? (Object.fromEntries(dbKeys.map(([k, v]) => [k, v.trim()])) as PlanBody["choices"]["dbEnvKeys"]) : undefined,
    port: port !== undefined && Number.isFinite(port) ? port : undefined,
    dockerImage: d.dockerImage.trim() || undefined,
    domain: d.domain.trim().toLowerCase() || undefined,
    envChoices: activeEnvRows(d).map((r) => ({ name: r.name, valueSource: r.valueSource })),
  };
}

export type DraftProblem = "appName" | "platform" | "plan" | "port" | "deploySource" | "domain" | "envName" | "dbEngine" | "dbPlan";

/** Cheap client-side checks so obvious mistakes are shown before a round trip. The server re-validates everything. */
export function draftProblems(d: Draft, hasSource: boolean): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!AppNameSchema.safeParse(d.appName.trim()).success) out.push("appName");
  if (d.platform === "") out.push("platform");
  if (d.planId === "") out.push("plan");
  const port = d.port.trim();
  if (port !== "" && !(Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535)) out.push("port");
  if (!hasSource && d.dockerImage.trim() === "") out.push("deploySource");
  if (d.domain.trim() !== "" && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,}$/i.test(d.domain.trim())) out.push("domain");
  if (d.env.some((r) => r.include && !ENV_NAME_RE.test(r.name))) out.push("envName");
  if (d.includeDb && !(DB_ENGINES as readonly string[]).includes(d.dbEngine)) out.push("dbEngine");
  if (d.includeDb && d.dbPlanId === "") out.push("dbPlan");
  return out;
}

/** Names of active user-sourced rows that still have no value. */
export function missingUserValues(d: Draft, required?: readonly string[]): string[] {
  const rows = activeEnvRows(d).filter((r) => r.valueSource === "user");
  const need = required ? new Set(required) : null;
  return rows.filter((r) => (!need || need.has(r.name)) && r.value === "").map((r) => r.name);
}

/** The ONLY place values leave the draft: exactly the keys the plan asks for. */
export function collectUserValues(d: Draft, required: readonly string[]): Record<string, string> {
  const need = new Set(required);
  const out: Record<string, string> = {};
  for (const r of activeEnvRows(d)) if (r.valueSource === "user" && need.has(r.name)) out[r.name] = r.value;
  return out;
}
