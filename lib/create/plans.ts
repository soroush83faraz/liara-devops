// Normalises `GET /v1/me` (+ billing + networks) into the PlansResponse DTO. Pure and lenient: unknown shapes are
// skipped, missing numbers are omitted (never defaulted to 0), and nothing here talks to Liara.
import { PLATFORMS } from "@/lib/contracts/common";
import { normalizeAccount } from "@/lib/liara/account";
import type { Me } from "@/lib/liara/schemas";
import { monthlyOf } from "./cost";
import type { AppPlanDto, BundlePlanDto, DbPlanDto, DbVersionDto, NetworkDto, PlansResponse } from "./types";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** Liara writes RAM / CPU as `{amount}` (GB / cores) or a bare number. */
const amount = (v: unknown): number | undefined => (isRec(v) ? num(v.amount) : num(v));
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** CLI-like visibility: available, Iran region (or region unspecified), and `free` or a `g2` plan. */
export function isVisiblePlan(id: string, raw: Rec): boolean {
  const region = str(raw.region);
  return raw.available === true && (!region || region === "iran") && (id === "free" || id.includes("g2"));
}

function price(id: string, raw: Rec): { hourlyToman?: number; monthlyToman?: number } {
  const hourly = num(raw.price);
  // Only the `free` plan may be 0; a 0 elsewhere is a missing price, not a free plan.
  if (hourly === undefined || hourly < 0 || (hourly === 0 && id !== "free")) return {};
  return { hourlyToman: hourly, monthlyToman: monthlyOf(hourly) };
}

function bundles(src: unknown): Record<string, BundlePlanDto[]> {
  const out: Record<string, BundlePlanDto[]> = {};
  if (!isRec(src)) return out;
  for (const [planId, group] of Object.entries(src)) {
    if (!isRec(group)) continue;
    const list: BundlePlanDto[] = [];
    for (const [id, b] of Object.entries(group)) {
      if (!isRec(b) || b.available === false) continue;
      list.push({ id, label: id, ...(num(b.displayPrice) !== undefined ? { displayPrice: num(b.displayPrice) } : {}) });
    }
    if (list.length) out[planId] = list;
  }
  return out;
}

function appPlans(src: unknown): { plans: AppPlanDto[]; hidden: boolean } {
  const plans: AppPlanDto[] = [];
  let hidden = false;
  if (!isRec(src)) return { plans, hidden };
  for (const [id, raw] of Object.entries(src)) {
    if (!isRec(raw)) continue;
    if (!isVisiblePlan(id, raw)) {
      hidden = true;
      continue;
    }
    const ram = amount(raw.RAM);
    plans.push({
      id,
      label: id,
      ...(ram !== undefined ? { ramMb: Math.round(ram * 1024) } : {}),
      ...(amount(raw.CPU) !== undefined ? { cpu: amount(raw.CPU) } : {}),
      ...(num(raw.volume) !== undefined ? { diskGb: num(raw.volume) } : {}),
      ...price(id, raw),
      available: true,
      ...(str(raw.region) ? { region: str(raw.region) } : {}),
    });
  }
  return { plans, hidden };
}

function dbPlans(src: unknown): { plans: DbPlanDto[]; hidden: boolean } {
  const plans: DbPlanDto[] = [];
  let hidden = false;
  if (!isRec(src)) return { plans, hidden };
  for (const [id, raw] of Object.entries(src)) {
    if (!isRec(raw)) continue;
    if (!isVisiblePlan(id, raw)) {
      hidden = true;
      continue;
    }
    const ram = amount(raw.RAM);
    plans.push({
      id,
      supports: Array.isArray(raw.supports) ? raw.supports.filter((x): x is string => typeof x === "string") : [],
      ...(ram !== undefined ? { ramMb: Math.round(ram * 1024) } : {}),
      ...(amount(raw.CPU) !== undefined ? { cpu: amount(raw.CPU) } : {}),
      ...(num(raw.volume) !== undefined ? { volumeGb: num(raw.volume) } : {}),
      ...price(id, raw),
      available: true,
    });
  }
  return { plans, hidden };
}

function dbVersions(me: Me): { versions: Record<string, DbVersionDto[]>; defaults: Record<string, string> } {
  const versions: Record<string, DbVersionDto[]> = {};
  const defaults: Record<string, string> = {};
  for (const [engine, list] of Object.entries(me.databaseVersions ?? {})) {
    if (!Array.isArray(list)) continue;
    const items = list.flatMap((v): DbVersionDto[] =>
      isRec(v) && typeof v.value === "string" && v.value ? [{ value: v.value, label: str(v.label) ?? v.value }] : [],
    );
    if (items.length) versions[engine] = items;
  }
  for (const [engine, d] of Object.entries(me.defaultDatabaseVersions ?? {})) {
    const value = typeof d === "string" ? d : isRec(d) ? str(d.value) : undefined;
    if (value && versions[engine]?.some((v) => v.value === value)) defaults[engine] = value;
  }
  return { versions, defaults };
}

export interface PlanSources {
  me: Me;
  /** `undefined` when billing could not be read. */
  balanceToman?: number;
  /** Team mode and Liara returned no usable team balance (the personal balance is never substituted). */
  balanceUnreadable?: boolean;
  /** The session's team id: network feature flags then come from `me.team`. */
  teamId?: string;
  /** `undefined` when networks could not be read. */
  networks?: NetworkDto[];
  now?: Date;
}

export function normalizePlans({ me, balanceToman, balanceUnreadable, teamId, networks, now = new Date() }: PlanSources): PlansResponse {
  const apps = appPlans(me.plans?.projects);
  const dbs = dbPlans(me.plans?.databases);
  const { versions, defaults } = dbVersions(me);
  const partial: PlansResponse["partial"] = [];
  const account = normalizeAccount(me, teamId);
  if (balanceToman === undefined) partial.push("balance");
  if (networks === undefined) partial.push("networks");
  return {
    appPlans: apps.plans,
    bundlePlans: bundles(me.plans?.projectBundlePlans),
    dbPlans: dbs.plans,
    dbBundlePlans: bundles(me.plans?.databaseBundlePlans),
    dbVersions: versions,
    defaultDbVersions: defaults,
    platforms: [...PLATFORMS],
    networks: networks ?? [],
    ...(balanceToman !== undefined ? { balanceToman } : {}),
    ...(balanceUnreadable ? { balanceUnreadable: true } : {}),
    flags: {
      ...(typeof account.privateNetworkFeature === "boolean" ? { privateNetworkFeature: account.privateNetworkFeature } : {}),
      ...(typeof account.legacyNetworkFeature === "boolean" ? { legacyNetworkFeature: account.legacyNetworkFeature } : {}),
    },
    filtered: { apps: apps.hidden, dbs: dbs.hidden },
    partial,
    generatedAt: now.toISOString(),
  };
}

/** Plans of a DB engine (`supports` empty = unspecified = allowed). */
export function dbPlansFor(plans: PlansResponse, engine: string | undefined): DbPlanDto[] {
  if (!engine) return [];
  return plans.dbPlans.filter((p) => p.supports.length === 0 || p.supports.includes(engine));
}

/** A plan can be picked only when available AND priced (we never show a made-up price). */
export const isSelectable = (p: { available: boolean; hourlyToman?: number }): boolean => p.available && p.hourlyToman !== undefined;
