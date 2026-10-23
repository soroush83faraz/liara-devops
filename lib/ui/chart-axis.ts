// Shared axis helpers for the recharts area charts (monitoring dashboard, service panel resources tab):
// Persian digits on every tick, tooltip and label, and a y axis that climbs in even, round steps.
import { faNumber } from "@/lib/i18n/format";

const TZ = "Asia/Tehran";
const clock = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const clockSec = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: TZ });

/** Unix seconds -> «۱۶:۱۴» (Tehran time). */
export const chartTime = (sec: number): string => clock.format(new Date(sec * 1000));
/** Unix seconds -> «۱۶:۱۴:۰۵» (Tehran time), for tooltips. */
export const chartTimeSec = (sec: number): string => clockSec.format(new Date(sec * 1000));
/** Value with Persian digits and the Persian decimal separator («۰٫۲۵», «۱٬۴۵۰»). */
export const chartNumber = (v: number, digits = 2): string => faNumber(v, { maximumFractionDigits: digits });

const ROUND = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];

/** Smallest «round» step (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5 or 8 x 10^n) that is at least `raw`. */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (ROUND.find((m) => f <= m + 1e-9) ?? 10) * pow;
}

/**
 * Even y ticks from 0: `intervals` equal round steps whose top tick is >= `max` (0, 75, 150 — never 0, 70, 140 or
 * 0, 150, 280). A non-positive or non-finite max gives 0..1.
 */
export function niceTicks(max: number, intervals: number): { top: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: Array.from({ length: intervals + 1 }, (_, i) => i / intervals) };
  const step = niceStep(max / intervals);
  // Rounding keeps 0.1 + 0.2 style float noise out of the labels.
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => Number((step * i).toPrecision(12)));
  return { top: ticks[intervals], ticks };
}

/** Largest value a chart will draw: per key, or the per-row sum when the keys are stacked. */
export function chartMax(rows: ReadonlyArray<Record<string, number | undefined>>, keys: readonly string[], stacked: boolean, floor = 0): number {
  let max = floor;
  for (const row of rows) {
    if (stacked) {
      let sum = 0;
      for (const k of keys) sum += Number.isFinite(row[k]) ? (row[k] as number) : 0;
      if (sum > max) max = sum;
    } else {
      for (const k of keys) {
        const v = row[k];
        if (v !== undefined && Number.isFinite(v) && v > max) max = v;
      }
    }
  }
  return max;
}

/**
 * Overlaid (not stacked) series can coincide exactly (e.g. network receive == transmit): the later ones are dashed so
 * the earlier line still shows through the gaps. The legend draws the same dash, so each key matches its line.
 */
export const seriesDash = (index: number, stacked: boolean): string | undefined => (!stacked && index > 0 ? "6 4" : undefined);
