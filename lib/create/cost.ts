// Cost maths for the wizards. Liara bills hourly; the monthly figure we show is hourly x 720 (an ESTIMATE).
import { faNumber } from "@/lib/i18n/format";
import { HOURS_PER_MONTH } from "./limits";

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const monthlyOf = (hourly: number): number => round2(hourly * HOURS_PER_MONTH);

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface CostLine {
  hourly: number;
  monthly: number;
}

/** Sum of the known hourly prices; null when ANY part is unknown (never a partial total presented as complete). */
export function totalCost(hourlies: Array<number | undefined>): CostLine | null {
  if (hourlies.some((h) => !isNum(h) || h < 0)) return null;
  const hourly = round2((hourlies as number[]).reduce((a, b) => a + b, 0));
  return { hourly, monthly: monthlyOf(hourly) };
}

/** Toman with Persian digits; keeps up to 2 decimals for small amounts so «۰٫۵ تومان» is not shown as «۱». */
export function formatToman(n: number): string {
  const digits = Math.abs(n) < 100 && !Number.isInteger(n) ? 2 : 0;
  return faNumber(n, { maximumFractionDigits: digits });
}

export type BalanceGate =
  | { status: "unknown" }
  /** Team mode and Liara returned no usable team balance: a priced resource cannot be created (the server refuses). */
  | { status: "team_unreadable" }
  | { status: "ok"; balance: number }
  | { status: "insufficient"; balance: number; needed: number };

/**
 * Blocks only when the balance is KNOWN and below one hour of the new cost (Liara bills from creation).
 * A free resource (0/hour) never blocks. An unknown balance never blocks (the server/Liara still can).
 */
export function balanceGate(balance: number | undefined, hourly: number | undefined, teamUnreadable = false): BalanceGate {
  if (teamUnreadable && !(isNum(hourly) && hourly <= 0)) return { status: "team_unreadable" };
  if (!isNum(balance)) return { status: "unknown" };
  if (!isNum(hourly) || hourly <= 0) return { status: "ok", balance };
  return balance < hourly ? { status: "insufficient", balance, needed: hourly } : { status: "ok", balance };
}
