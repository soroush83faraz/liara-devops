// Pure maths for the dashboard: per-service totals, aligned stacking, min/avg/max, current value vs limit.
// Nothing here invents data: a bucket nobody reported stays absent.
import { BYTES_PER_MIB } from "@/lib/service/app-read/chart-data";
import { RANGE_SECONDS } from "@/lib/service/app-read/metrics-range";
import type { MetricRange, MetricSeriesSection, MetricsDto, MetricsUnavailableDto, UsageValue } from "@/lib/service/app-read/types";

export interface Point {
  t: number;
  v: number;
}

/** ~60 buckets per window: 15 s for 15 m, 1 min for 1 h, 6 min for 6 h, 24 min for 24 h. */
export function bucketSeconds(range: MetricRange): number {
  return Math.max(1, Math.round(RANGE_SECONDS[range] / 60));
}

/**
 * One line per service: every applet series is averaged per bucket, then applets are summed per bucket
 * (CPU cores / memory bytes of the whole service). A bucket is emitted only if at least one applet reported in it.
 */
export function sectionTotals(section: MetricSeriesSection, bucketSec: number, map: (v: number) => number = (v) => v): Point[] {
  if (section.unavailable) return [];
  const totals = new Map<number, number>();
  for (const s of section.series) {
    const perBucket = new Map<number, { sum: number; n: number }>();
    for (const p of s.points) {
      if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
      const b = Math.floor(p.t / bucketSec) * bucketSec;
      const cur = perBucket.get(b) ?? { sum: 0, n: 0 };
      cur.sum += p.v;
      cur.n += 1;
      perBucket.set(b, cur);
    }
    for (const [b, { sum, n }] of perBucket) totals.set(b, (totals.get(b) ?? 0) + sum / n);
  }
  return [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v: map(v) }));
}

export interface StackKey {
  key: string;
  id: string;
  label: string;
  color: string;
}

export interface StackedRows {
  keys: StackKey[];
  /** `{t, s0, s1, ...}`; a service that reported nothing in a bucket has no property (it is absent, not zero). */
  rows: Array<Record<string, number>>;
}

/** Aligns per-service lines on their (bucketed) timestamps for a stacked chart. Services without points are left out. */
export function stackServices(
  lines: ReadonlyArray<{ id: string; label: string; color: string; points: readonly Point[] }>,
): StackedRows {
  const used = lines.filter((l) => l.points.length > 0);
  const keys = used.map((l, i) => ({ key: `s${i}`, id: l.id, label: l.label, color: l.color }));
  const byT = new Map<number, Record<string, number>>();
  used.forEach((l, i) => {
    for (const p of l.points) {
      const row = byT.get(p.t) ?? { t: p.t };
      row[`s${i}`] = p.v;
      byT.set(p.t, row);
    }
  });
  return { keys, rows: [...byT.values()].sort((a, b) => a.t! - b.t!) };
}

export interface Stats {
  min: number;
  avg: number;
  max: number;
}

/** min / average / max of finite values; null when there are none. */
export function seriesStats(values: readonly number[]): Stats | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  return { min, avg: sum / v.length, max };
}

/** Stats over every point of every series of a chart (used for the chart's text alternative). */
export function statsOfSeries(series: ReadonlyArray<{ points: ReadonlyArray<{ v: number }> }>): Stats | null {
  return seriesStats(series.flatMap((s) => s.points.map((p) => p.v)));
}

export type ResourceKey = "cpu" | "memory";

const sumValues = (xs: readonly UsageValue[]): number | undefined => (xs.length === 0 ? undefined : xs.reduce((a, x) => a + x.value, 0));

/**
 * Current value of the whole service (summed over applets). Prefers Liara's summary call; falls back to the newest
 * point of the series only when the summary is missing. Raw units (CPU cores, memory bytes), unverified [VAL].
 */
export function currentValue(metrics: MetricsDto | MetricsUnavailableDto, key: ResourceKey): number | undefined {
  if (metrics.unavailable) return undefined;
  const fromSummary = sumValues(metrics.current?.[key] ?? []);
  if (fromSummary !== undefined) return fromSummary;
  const section = metrics[key];
  if (section.unavailable) return undefined;
  const latest = new Map<string, number>();
  for (const [i, s] of section.series.entries()) {
    const last = s.points.at(-1);
    if (!last) continue;
    latest.set(s.applet ?? `#${i}`, last.v);
  }
  return latest.size === 0 ? undefined : [...latest.values()].reduce((a, b) => a + b, 0);
}

/** Plan limit in the unit used on screen: CPU cores, memory MiB. Undefined when the plan did not say. */
export function limitValue(metrics: MetricsDto | MetricsUnavailableDto, key: ResourceKey): number | undefined {
  if (metrics.unavailable) return undefined;
  const l = metrics.limits;
  if (!l) return undefined;
  if (key === "cpu") return l.cpu !== undefined && l.cpu > 0 ? l.cpu : undefined;
  return l.ramGb !== undefined && l.ramGb > 0 ? l.ramGb * 1024 : undefined;
}

/** Value in on-screen units (memory bytes -> MiB). */
export const displayValue = (key: ResourceKey, raw: number): number => (key === "memory" ? raw / BYTES_PER_MIB : raw);

/** 0..1 share of the limit (clamped); undefined without both numbers. */
export function usageRatio(value: number | undefined, limit: number | undefined): number | undefined {
  if (value === undefined || limit === undefined || limit <= 0 || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value / limit));
}

/**
 * Fixed colour per service slot: the validated categorical palette in app/globals.css (--series-1..8), stepped per
 * theme. Strokes/fills only; text never relies on it. Slots past the eighth are never a generated hue: they share the
 * neutral --series-other and the aggregate charts fold them into one «سایر» series.
 */
export const SERVICE_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

export const OTHER_SERIES_COLOR = "var(--series-other)";

export const colorForIndex = (i: number): string => SERVICE_COLORS[i] ?? OTHER_SERIES_COLOR;
