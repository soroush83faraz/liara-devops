// Plan price comparison for the resize dialog. Prices are toman per hour as reported by Liara; monthly = hourly x 720.
import { monthlyFromHourly, type NormalizedPlan } from "../../liara/account";

export interface PlanOptionDto {
  id: string;
  ramGb?: number;
  cpu?: number;
  diskGb?: number;
  /** False when Liara gave no price for this plan: the UI shows «قیمت نامشخص» and the numbers below are omitted. */
  priceKnown: boolean;
  /** Omitted when `priceKnown` is false (never 0). */
  pricePerHour?: number;
  pricePerMonth?: number;
  current: boolean;
  /** Difference to the current plan; undefined when either price is unknown. */
  deltaPerHour?: number;
  deltaPerMonth?: number;
  direction: "up" | "down" | "same" | "unknown";
}

export function comparePlans(
  current: Pick<NormalizedPlan, "pricePerHour" | "priceKnown"> | undefined,
  target: Pick<NormalizedPlan, "pricePerHour" | "priceKnown">,
): Pick<PlanOptionDto, "deltaPerHour" | "deltaPerMonth" | "direction"> {
  if (!current || !current.priceKnown || !target.priceKnown) return { direction: "unknown" };
  const deltaPerHour = Math.round((target.pricePerHour - current.pricePerHour) * 1e6) / 1e6;
  return {
    deltaPerHour,
    deltaPerMonth: monthlyFromHourly(deltaPerHour),
    direction: deltaPerHour > 0 ? "up" : deltaPerHour < 0 ? "down" : "same",
  };
}

/** Options sorted by price; the current plan is included (flagged) even if it is no longer purchasable. */
export function buildPlanOptions(available: readonly NormalizedPlan[], all: readonly NormalizedPlan[], currentId: string | undefined): PlanOptionDto[] {
  const current = currentId ? all.find((p) => p.id === currentId) : undefined;
  const list = [...available];
  if (current && !list.some((p) => p.id === current.id)) list.push(current);
  return list
    // Unpriced plans sort last (they are not "cheapest").
    .sort((a, b) => Number(b.priceKnown) - Number(a.priceKnown) || (a.priceKnown ? a.pricePerHour - b.pricePerHour : 0) || a.id.localeCompare(b.id))
    .map((p) => ({
      id: p.id,
      priceKnown: p.priceKnown,
      ...(p.ramGb !== undefined ? { ramGb: p.ramGb } : {}),
      ...(p.cpu !== undefined ? { cpu: p.cpu } : {}),
      ...(p.diskGb !== undefined ? { diskGb: p.diskGb } : {}),
      ...(p.priceKnown ? { pricePerHour: p.pricePerHour, pricePerMonth: p.pricePerMonth } : {}),
      current: p.id === currentId,
      ...comparePlans(current, p),
    }));
}
