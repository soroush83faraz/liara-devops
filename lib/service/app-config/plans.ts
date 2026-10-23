// Plan-cost comparison for the resize dialog. Pure; prices are Liara's own numbers, never invented.
import type { PlanOption } from "./dto";

const HOURS_PER_MONTH = 720;
const round2 = (n: number) => Math.round(n * 100) / 100;
export const monthlyOf = (hourly: number): number => round2(hourly * HOURS_PER_MONTH);

export type PlanDirection = "up" | "down" | "same_price" | "same_plan" | "unknown";

export interface PlanComparison {
  direction: PlanDirection;
  deltaHourly?: number;
  deltaMonthly?: number;
  ramDeltaGb?: number;
  cpuDelta?: number;
  /** The current price came from the app's own `hourlyPrice` (may include add-ons) rather than a plan row. */
  approximate: boolean;
}

/**
 * Compares `target` with the current plan. Prefers plan-to-plan prices (same units); falls back to the app's
 * reported hourly price and says so. When neither is known the direction is «unknown» and no delta is shown.
 */
export function comparePlans(
  current: PlanOption | undefined,
  currentHourlyFallback: number | undefined,
  target: PlanOption,
): PlanComparison {
  if (current && current.id === target.id) return { direction: "same_plan", approximate: false };
  // A plan row without a price is "unknown", not 0; the app's own hourly price is only a fallback when the row is absent.
  const base = current ? (current.priceKnown ? current.pricePerHour : undefined) : currentHourlyFallback;
  const approximate = current === undefined && base !== undefined;
  const out: PlanComparison = { direction: "unknown", approximate };
  if (current?.ramGb !== undefined && target.ramGb !== undefined) out.ramDeltaGb = round2(target.ramGb - current.ramGb);
  if (current?.cpu !== undefined && target.cpu !== undefined) out.cpuDelta = round2(target.cpu - current.cpu);
  if (base === undefined || !target.priceKnown || target.pricePerHour === undefined) return out;
  const delta = round2(target.pricePerHour - base);
  out.deltaHourly = delta;
  out.deltaMonthly = monthlyOf(target.pricePerHour) - monthlyOf(base);
  out.deltaMonthly = round2(out.deltaMonthly);
  out.direction = delta > 0 ? "up" : delta < 0 ? "down" : "same_price";
  return out;
}
