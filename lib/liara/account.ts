import { BillingSchema, MeSchema, type Billing, type Me } from "./schemas";
import type { LiaraClient } from "./core";
import { isRecord } from "./util";

/** [V] GET /v1/me: user, team, plans, databaseVersions, feature flags. */
export function getMe(client: LiaraClient): Promise<Me> {
  return client.get("/v1/me", MeSchema);
}

/** [V] GET /v1/billing. Raw (lenient) body: in team mode it has `user` AND `team`; use `getAccountBilling` for the right one. */
export function getBilling(client: LiaraClient): Promise<Billing> {
  return client.get("/v1/billing", BillingSchema);
}

/** The team id of a client as a normalizer argument (`""` = personal account = undefined). */
export const teamIdOf = (client: Pick<LiaraClient, "teamId">): string | undefined => client.teamId || undefined;

export type AccountSource = "team" | "user";

export interface NormalizedBilling {
  /** Whose wallet `balance` is. "team" whenever a team id was supplied (even when the team object is missing). */
  source: AccountSource;
  /** Toman. `undefined` = UNKNOWN (never 0, never the personal balance as a stand-in for a team). */
  balance?: number;
  accountType?: string;
  minCreditAmount?: number;
  isManualMinCredit?: boolean;
  /** Known balance strictly below `minCreditAmount` (Liara's own low-credit threshold); false when either is unknown. */
  belowMinCredit: boolean;
  /**
   * True when a team id was supplied but Liara's response has no usable `team` balance. The personal balance is NOT
   * used instead: billed creates must be refused and the UI says the balance could not be read for this team.
   */
  teamUnreadable: boolean;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Picks the wallet that pays: `team` when a team id was supplied AND the response has a `team` object, `user`
 * otherwise. A supplied team id with no `team` object (or without a numeric balance) yields an UNKNOWN balance.
 * Verified live 2026-10-23: team mode returns `user` (the person) and `team` (the money); use `team.balance`.
 */
export function normalizeBilling(billing: Billing, teamId?: string): NormalizedBilling {
  const inTeam = Boolean(teamId);
  const party = inTeam ? billing.team : billing.user;
  const balance = finite(party?.balance) ? party.balance : undefined;
  const minCreditAmount = finite(party?.minCreditAmount) ? party.minCreditAmount : undefined;
  return {
    source: inTeam ? "team" : "user",
    ...(balance !== undefined ? { balance } : {}),
    ...(party?.accountType !== undefined ? { accountType: party.accountType } : {}),
    ...(minCreditAmount !== undefined ? { minCreditAmount } : {}),
    ...(party?.isManualMinCredit !== undefined ? { isManualMinCredit: party.isManualMinCredit } : {}),
    belowMinCredit: balance !== undefined && minCreditAmount !== undefined && balance < minCreditAmount,
    teamUnreadable: inTeam && balance === undefined,
  };
}

/** `GET /v1/billing` normalised for the client's team context. */
export async function getAccountBilling(client: LiaraClient): Promise<NormalizedBilling> {
  return normalizeBilling(await getBilling(client), teamIdOf(client));
}

export interface NormalizedAccount {
  source: AccountSource;
  /** Present only in team mode with a `team` object. */
  teamId?: string;
  teamName?: string;
  /** The signed-in person's role inside the team. */
  teamMemberRole?: string;
  /** Carried through as data only; its shape and meaning are not verified (it may restrict billing/creates). */
  teamMemberPermissions?: unknown;
  privateNetworkFeature?: boolean;
  legacyNetworkFeature?: boolean;
  minCreditAmount?: number;
  /** A team id was supplied but `GET /v1/me` has no `team` object: nothing team-specific is known. */
  teamUnreadable: boolean;
}

/** Account facts of `GET /v1/me`: from `team` when a team id was supplied and the object exists, else from `user`. */
export function normalizeAccount(me: Me, teamId?: string): NormalizedAccount {
  if (teamId) {
    const t = me.team;
    if (!t) return { source: "team", teamUnreadable: true };
    return {
      source: "team",
      ...(t._id ? { teamId: t._id } : {}),
      ...(t.teamName ? { teamName: t.teamName } : {}),
      ...(t.teamMemberRole ? { teamMemberRole: t.teamMemberRole } : {}),
      ...(t.teamMemberPermissions !== undefined ? { teamMemberPermissions: t.teamMemberPermissions } : {}),
      ...(typeof t.privateNetworkFeature === "boolean" ? { privateNetworkFeature: t.privateNetworkFeature } : {}),
      ...(typeof t.legacyNetworkFeature === "boolean" ? { legacyNetworkFeature: t.legacyNetworkFeature } : {}),
      ...(finite(t.minCreditAmount) ? { minCreditAmount: t.minCreditAmount } : {}),
      teamUnreadable: false,
    };
  }
  const u = me.user;
  return {
    source: "user",
    ...(typeof u?.privateNetworkFeature === "boolean" ? { privateNetworkFeature: u.privateNetworkFeature } : {}),
    ...(typeof u?.legacyNetworkFeature === "boolean" ? { legacyNetworkFeature: u.legacyNetworkFeature } : {}),
    teamUnreadable: false,
  };
}

export const HOURS_PER_MONTH = 720;

export interface BundlePlan {
  id: string;
  available: boolean;
  /** Monthly price as displayed by Liara (`displayPrice`) [CLI]. */
  monthlyPrice?: number;
  maxLogsRetentionDays?: number;
}

export interface NormalizedPlan {
  id: string;
  available: boolean;
  region?: string;
  ramGb?: number;
  cpu?: number;
  diskGb?: number;
  storageClass?: string;
  /** Engines a DB plan supports [CLI db/resize.ts]. */
  supports?: string[];
  /**
   * Toman per hour. MEANINGLESS (0) when `priceKnown` is false: a plan whose price is missing from `GET /v1/me`
   * must never be recommended, proposed or costed as free. Always check `priceKnown` before using it.
   */
  pricePerHour: number;
  /** pricePerHour * 720, rounded to 2 decimals [CLI]. Meaningless when `priceKnown` is false. */
  pricePerMonth: number;
  /**
   * True only when Liara reported a finite price > 0, or for the `free` plan (the only legitimate zero price).
   * A missing, non-numeric, negative or zero price on any other plan is "unknown", not "free".
   */
  priceKnown: boolean;
  /** Not "free" and not a "g2" plan: the CLI hides these. */
  legacy: boolean;
  bundles: BundlePlan[];
}

export interface PlanFilter {
  /** default true */
  availableOnly?: boolean;
  /** default "iran"; plans without a region always pass. Use "any" to disable. */
  region?: string;
  /** default false */
  includeLegacy?: boolean;
}

const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const amount = (v: unknown): number | undefined => (isRecord(v) ? n(v.amount) : n(v));

export const monthlyFromHourly = (perHour: number): number => Math.round(perHour * HOURS_PER_MONTH * 100) / 100;

function normalize(plans: Record<string, unknown> | undefined, bundles: Record<string, unknown> | undefined, f: PlanFilter): NormalizedPlan[] {
  const { availableOnly = true, region = "iran", includeLegacy = false } = f;
  const out: NormalizedPlan[] = [];
  for (const [id, raw] of Object.entries(plans ?? {})) {
    if (!isRecord(raw)) continue;
    const available = raw.available === true;
    const planRegion = typeof raw.region === "string" ? raw.region : undefined;
    const legacy = !(id === "free" || id.includes("g2"));
    if (availableOnly && !available) continue;
    if (region !== "any" && planRegion && planRegion !== region) continue;
    if (!includeLegacy && legacy) continue;
    const rawPrice = n(raw.price);
    const priceKnown = id === "free" ? rawPrice === undefined || rawPrice >= 0 : rawPrice !== undefined && rawPrice > 0;
    const perHour = priceKnown ? (rawPrice ?? 0) : 0;
    const b = bundles?.[id];
    out.push({
      id,
      available,
      region: planRegion,
      ramGb: amount(raw.RAM),
      cpu: amount(raw.CPU),
      diskGb: n(raw.volume),
      storageClass: typeof raw.storageClass === "string" ? raw.storageClass : undefined,
      supports: Array.isArray(raw.supports) ? raw.supports.filter((x): x is string => typeof x === "string") : undefined,
      pricePerHour: perHour,
      pricePerMonth: monthlyFromHourly(perHour),
      priceKnown,
      legacy,
      bundles: isRecord(b)
        ? Object.entries(b).flatMap(([bid, bv]) =>
            isRecord(bv)
              ? [{ id: bid, available: bv.available === true, monthlyPrice: n(bv.displayPrice), maxLogsRetentionDays: n(bv.maxLogsRetention) }]
              : [],
          )
        : [],
    });
  }
  return out;
}

/** App plans from `GET /v1/me` (`plans.projects` + `plans.projectBundlePlans`). Shapes inferred from the CLI [VAL]. */
export function listAppPlans(me: Me, filter: PlanFilter = {}): NormalizedPlan[] {
  return normalize(me.plans?.projects, me.plans?.projectBundlePlans, filter);
}

/** DB plans from `GET /v1/me` (`plans.databases` + `plans.databaseBundlePlans`); optional `engine` filters on `supports`. */
export function listDbPlans(me: Me, filter: PlanFilter & { engine?: string } = {}): NormalizedPlan[] {
  const all = normalize(me.plans?.databases, me.plans?.databaseBundlePlans, filter);
  return filter.engine ? all.filter((p) => !p.supports || p.supports.includes(filter.engine!)) : all;
}

export interface DbVersions {
  engine: string;
  versions: Array<{ label: string; value: string; postgisValue?: string; pgvectorValue?: string }>;
  defaultVersion?: string;
}

/** `databaseVersions` -> one entry per engine; `defaultDatabaseVersions` shape is a guess [VAL]. */
export function listDbVersions(me: Me): DbVersions[] {
  const defaults = me.defaultDatabaseVersions ?? {};
  return Object.entries(me.databaseVersions ?? {}).map(([engine, list]) => {
    const versions = (Array.isArray(list) ? list : []).flatMap((v) => {
      if (!isRecord(v) || typeof v.value !== "string") return [];
      return [
        {
          label: typeof v.label === "string" ? v.label : v.value,
          value: v.value,
          postgisValue: typeof v.postgisValue === "string" ? v.postgisValue : undefined,
          pgvectorValue: typeof v.pgvectorValue === "string" ? v.pgvectorValue : undefined,
        },
      ];
    });
    const d = defaults[engine];
    const defaultVersion = typeof d === "string" ? d : isRecord(d) && typeof d.value === "string" ? d.value : undefined;
    return { engine, versions, defaultVersion };
  });
}
