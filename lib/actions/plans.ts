// Plan, price and balance checks for billed actions. Liara bills hourly; monthly = hourly x 720.
// Plan shapes come from `GET /v1/me` and are inferred from the CLI [VAL]: when they cannot be read the
// action proceeds without a cost line (the wizard showed one), but a plan Liara lists as unknown or
// unavailable is refused.
import { getAccountBilling, getMe, teamIdOf, listAppPlans, listDbPlans, listDbVersions, type LiaraClient, type Me, type NormalizedPlan } from "@/lib/liara";
import { costFromHourly, type Cost } from "@/lib/contracts/common";
import { ActionError } from "./errors";

export async function readMe(liara: LiaraClient): Promise<Me | undefined> {
  try {
    return await getMe(liara);
  } catch {
    return undefined;
  }
}

const ALL: { availableOnly: false; region: "any"; includeLegacy: true } = { availableOnly: false, region: "any", includeLegacy: true };

export function appPlans(me: Me | undefined): NormalizedPlan[] {
  return me ? listAppPlans(me, ALL) : [];
}

export function dbPlans(me: Me | undefined, engine?: string): NormalizedPlan[] {
  return me ? listDbPlans(me, { ...ALL, engine }) : [];
}

export interface PlanChoice {
  planId: string;
  bundlePlanId: string;
  /** undefined when the plan list could not be read. */
  cost?: Cost;
  bundleMonthlyToman?: number;
}

/**
 * Validates planId/bundle against the listed plans. Without an explicit bundle: `free` for the free plan, the
 * only available bundle when there is exactly one, otherwise an error (never silently pick a priced bundle).
 */
export function choosePlan(plans: readonly NormalizedPlan[], planId: string, bundlePlanId: string | undefined): PlanChoice {
  if (plans.length === 0) {
    if (bundlePlanId === undefined && planId !== "free") throw new ActionError("invalid", { details: { reason: "bundle_required", planId } });
    return { planId, bundlePlanId: bundlePlanId ?? "free" };
  }
  const plan = plans.find((p) => p.id === planId);
  if (!plan || !plan.available) throw new ActionError("invalid", { details: { reason: "plan_unavailable", planId } });
  const available = plan.bundles.filter((b) => b.available);
  let bundle = bundlePlanId;
  if (bundle === undefined) {
    if (planId === "free") bundle = "free";
    else if (available.length === 1) bundle = available[0].id;
    else throw new ActionError("invalid", { details: { reason: "bundle_required", planId } });
  }
  const b = plan.bundles.find((x) => x.id === bundle);
  if (plan.bundles.length > 0 && bundle !== "free" && (!b || !b.available)) {
    throw new ActionError("invalid", { details: { reason: "bundle_unavailable", planId, bundlePlanId: bundle } });
  }
  return {
    planId,
    bundlePlanId: bundle,
    // An unpriced plan has NO cost line (never 0): the balance check is skipped and the summary says null.
    ...(plan.priceKnown ? { cost: costFromHourly(plan.pricePerHour) } : {}),
    ...(b?.monthlyPrice !== undefined ? { bundleMonthlyToman: b.monthlyPrice } : {}),
  };
}

/**
 * Defence in depth for billed creates: a non-free plan must come with a known price (a listed `priceKnown`
 * plan). An unpriced or unreadable plan would skip the balance check and bill an unknown amount, so it is refused.
 */
export function assertPriced(choice: PlanChoice): void {
  if (choice.planId === "free" || choice.cost !== undefined) return;
  throw new ActionError("plan_price_unknown", { details: { planId: choice.planId } });
}

/** For resize: the target plan must be listed and available (when the list could be read). */
export function assertPlanAvailable(plans: readonly NormalizedPlan[], planId: string): void {
  if (plans.length === 0) return;
  const plan = plans.find((p) => p.id === planId);
  if (!plan || !plan.available) throw new ActionError("invalid", { details: { reason: "plan_unavailable", planId } });
}

/** Version check for create_db when Liara lists versions for the engine. */
export function assertDbVersion(me: Me | undefined, engine: string, version: string): void {
  if (!me) return;
  const listed = listDbVersions(me).find((v) => v.engine === engine);
  if (!listed || listed.versions.length === 0) return;
  const ok = listed.versions.some((v) => v.value === version || v.postgisValue === version || v.pgvectorValue === version);
  if (!ok) throw new ActionError("invalid", { details: { reason: "version_unavailable", engine, version } });
}

export interface BalanceCheck {
  checked: boolean;
}

/**
 * Refuses when the balance is known and below one hour of the new cost (payment-style error, 402). An unreadable
 * balance does not block in personal mode: Liara itself answers 402 and the executor maps it to `payment_required`
 * (the summary then says `balanceChecked:false`). The exception is team mode: when `GET /v1/billing` fails for any
 * reason or has no usable `team` balance, a priced create is refused (`team_balance_unreadable`).
 */
export async function checkBalance(liara: LiaraClient, perHourToman: number | undefined): Promise<BalanceCheck> {
  if (perHourToman === undefined || perHourToman <= 0) return { checked: false };
  let billing;
  try {
    billing = await getAccountBilling(liara);
  } catch {
    // Team mode: ANY failure to read billing (HTTP, network, schema) must not let a priced create through.
    if (teamIdOf(liara)) throw new ActionError("team_balance_unreadable", { details: { perHourToman } });
    return { checked: false };
  }
  // Team mode without a readable team balance: the personal balance is NOT a stand-in, so refuse the billed step.
  if (billing.teamUnreadable) throw new ActionError("team_balance_unreadable", { details: { perHourToman } });
  const balance = billing.balance;
  if (balance === undefined) return { checked: false };
  if (balance < perHourToman) throw new ActionError("insufficient_balance", { details: { perHourToman } });
  return { checked: true };
}

/** Cost difference between two listed plans; null when either plan or either price is unknown. */
export function costDelta(plans: readonly NormalizedPlan[], fromPlanId: string | undefined, toPlanId: string): Cost | null {
  const from = plans.find((p) => p.id === fromPlanId);
  const to = plans.find((p) => p.id === toPlanId);
  if (!from || !to || !from.priceKnown || !to.priceKnown) return null;
  const perHourToman = to.pricePerHour - from.pricePerHour;
  return { perHourToman, perMonthToman: Math.round(perHourToman * 720) };
}
