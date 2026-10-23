// Builds the final DeployPlan from the user's choices, re-validated against the real plans/networks.
// The result is parsed with DeployPlanSchema, so a plan that this function returns satisfies the contract.
import {
  AppNameSchema,
  DbNameSchema,
  DeployPlanSchema,
  DockerImageSchema,
  DomainNameSchema,
  EnvKeySchema,
  PLATFORMS,
  PortSchema,
  SafeIdSchema,
  sumStepCosts,
  type Cost,
  type DbEngine,
  type DeployPlan,
  type DeployPlanStep,
  type EnvChange,
  type Platform,
  type WireMapping,
} from "@/lib/contracts";
import type { DbVersions, NormalizedPlan } from "@/lib/liara/account";
import { PLATFORM_ENV_NAMES } from "./env-names";
import { validateWireMapping, wireMappingFor } from "./env-plan";
import { optionCost } from "./recommend";
import { defaultPortFor, toOption } from "./sizing";
import type { ProjectAnalysis } from "./types";

export interface EnvChoice {
  name: string;
  valueSource: "user" | "generated";
}

export interface PlanChoices {
  appName: string;
  platform?: Platform;
  networkId?: string;
  planId?: string;
  bundlePlanId?: string;
  includeDb?: boolean;
  dbEngine?: DbEngine;
  dbPlanId?: string;
  dbName?: string;
  dbEnvKeys?: Record<string, string>;
  port?: number;
  dockerImage?: string;
  domain?: string;
  envChoices: EnvChoice[];
}

export interface PlanContext {
  appPlans: readonly NormalizedPlan[];
  dbPlans: readonly NormalizedPlan[];
  dbVersions: readonly DbVersions[];
  networks: ReadonlyArray<{ _id: string; name: string }>;
  /** Server-side reference to the stored archive (from putSource). */
  sourceRef?: string;
}

export type PlanErrorCode =
  | "invalid_app_name" | "platform_required" | "unknown_platform" | "invalid_port" | "unknown_plan" | "unknown_bundle"
  | "unknown_network" | "invalid_network_name" | "db_engine_required" | "unknown_db_plan" | "no_db_version" | "invalid_db_name"
  | "invalid_wire_keys" | "invalid_env" | "invalid_domain" | "invalid_image" | "no_deploy_source" | "invalid_source_ref" | "plan_invalid"
  /** A billed component (the selected bundle) has no price from Liara: a total would understate the cost. */
  | "bundle_price_unknown";

export type PlanResult =
  | { ok: true; plan: DeployPlan; costs: { app: Cost; db?: Cost; totals: Cost }; effectivePort: number; platform: Platform }
  | { ok: false; code: PlanErrorCode; field?: string };

const fail = (code: PlanErrorCode, field?: string): PlanResult => ({ ok: false, code, field });

export function defaultDbName(app: string): string {
  const base = `${app}-db`.slice(0, 63).replace(/-+$/, "");
  return base;
}

export function buildDeployPlan(analysis: ProjectAnalysis, c: PlanChoices, ctx: PlanContext): PlanResult {
  const appName = AppNameSchema.safeParse(c.appName);
  if (!appName.success) return fail("invalid_app_name", "appName");

  const platform = c.platform ?? (analysis.platform === "unknown" ? undefined : analysis.platform);
  if (!platform) return fail("platform_required", "platform");
  if (!(PLATFORMS as readonly string[]).includes(platform)) return fail("unknown_platform", "platform");

  const portValue = c.port ?? analysis.port ?? defaultPortFor(platform);
  if (!PortSchema.safeParse(portValue).success) return fail("invalid_port", "port");

  // App plan: must exist and be available for this account.
  const planId = c.planId;
  // An unpriced plan is refused like an unknown one: costing it as free would understate every total.
  const appPlan = ctx.appPlans.find((p) => p.available && p.priceKnown && p.id === planId);
  if (!planId || !appPlan) return fail("unknown_plan", "planId");
  let bundleMonthly = 0;
  if (c.bundlePlanId) {
    const bundle = appPlan.bundles.find((b) => b.available && b.id === c.bundlePlanId);
    if (!bundle) return fail("unknown_bundle", "bundlePlanId");
    // Never cost an unknown-priced bundle as free: refuse the plan instead of presenting an understated total.
    if (typeof bundle.monthlyPrice !== "number" || !Number.isFinite(bundle.monthlyPrice) || bundle.monthlyPrice < 0) {
      return fail("bundle_price_unknown", "bundlePlanId");
    }
    bundleMonthly = bundle.monthlyPrice;
  }

  let network: string | undefined;
  if (c.networkId) {
    const n = ctx.networks.find((x) => x._id === c.networkId || x.name === c.networkId);
    if (!n) return fail("unknown_network", "networkId");
    network = n.name;
  }

  const appCost = optionCost(toOption(appPlan), bundleMonthly);
  const steps: Array<Record<string, unknown>> = [];
  steps.push({
    kind: "create_app",
    name: appName.data,
    platform,
    planId: appPlan.id,
    bundlePlanId: c.bundlePlanId,
    network,
    cost: appCost,
  });

  // Optional database.
  let dbName: string | undefined;
  let dbCost: Cost | undefined;
  let wire: WireMapping | undefined;
  if (c.includeDb) {
    const engine = c.dbEngine ?? analysis.requiresDatabase[0]?.engine;
    if (!engine) return fail("db_engine_required", "dbEngine");
    const version = ctx.dbVersions.find((v) => v.engine === engine);
    const versionValue = version?.defaultVersion ?? version?.versions[0]?.value;
    if (!versionValue) return fail("no_db_version", "dbEngine");
    const dbPlan = ctx.dbPlans.find((p) => p.available && p.priceKnown && p.id === c.dbPlanId && (!p.supports || p.supports.includes(engine)));
    if (!dbPlan) return fail("unknown_db_plan", "dbPlanId");
    const nameParsed = DbNameSchema.safeParse(c.dbName ?? defaultDbName(appName.data));
    if (!nameParsed.success) return fail("invalid_db_name", "dbName");
    dbName = nameParsed.data;
    dbCost = optionCost(toOption(dbPlan));
    steps.push({
      kind: "create_db",
      name: dbName,
      engine,
      version: versionValue,
      planId: dbPlan.id,
      network,
      publicNetwork: false,
      cost: dbCost,
    });
    wire = c.dbEnvKeys ? validateWireMapping(c.dbEnvKeys) : wireMappingFor(engine, analysis.envVarNames)?.mapping;
    if (!wire) return fail("invalid_wire_keys", "dbEnvKeys");
  }

  // Env vars: names + where the value comes from; DB-wired keys are excluded (the wiring step owns them).
  const wiredKeys = new Set(wire ? Object.values(wire).filter((k): k is string => typeof k === "string") : []);
  const changes: EnvChange[] = [];
  const seen = new Set<string>();
  for (const e of c.envChoices) {
    const key = EnvKeySchema.safeParse(e.name);
    if (!key.success) return fail("invalid_env", "envChoices");
    if (seen.has(e.name) || wiredKeys.has(e.name) || PLATFORM_ENV_NAMES.has(e.name)) continue;
    seen.add(e.name);
    changes.push(e.valueSource === "generated" ? { op: "set", key: key.data, valueSource: "generated", generator: "hex32" } : { op: "set", key: key.data, valueSource: "user" });
  }
  if (changes.length > 0) steps.push({ kind: "set_env", app: appName.data, changes });
  if (dbName && wire) steps.push({ kind: "wire_db", app: appName.data, db: dbName, mapping: wire });

  // Deploy source: uploaded archive or a Docker image.
  if (c.dockerImage) {
    const image = DockerImageSchema.safeParse(c.dockerImage);
    if (!image.success) return fail("invalid_image", "dockerImage");
    steps.push({ kind: "deploy", app: appName.data, source: { kind: "image", image: image.data }, port: portValue });
  } else if (ctx.sourceRef) {
    if (!SafeIdSchema.safeParse(ctx.sourceRef).success) return fail("invalid_source_ref", "sourceRef");
    steps.push({ kind: "deploy", app: appName.data, source: { kind: "upload", uploadId: ctx.sourceRef }, port: portValue });
  } else {
    return fail("no_deploy_source", "sourceRef");
  }

  let domain: string | undefined;
  if (c.domain) {
    const d = DomainNameSchema.safeParse(c.domain.trim().toLowerCase());
    if (!d.success) return fail("invalid_domain", "domain");
    domain = d.data;
  }
  steps.push({ kind: "domain_guidance", domain });

  const numbered = steps.map((s, i) => ({ id: `S${i + 1}`, ...s })) as DeployPlanStep[];
  const totals = sumStepCosts(numbered);
  const parsed = DeployPlanSchema.safeParse({ app: appName.data, network, steps: numbered, totals });
  if (!parsed.success) return fail("plan_invalid");
  return { ok: true, plan: parsed.data, costs: { app: appCost, db: dbCost, totals }, effectivePort: portValue, platform };
}
