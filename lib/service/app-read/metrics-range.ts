import type { MetricRange } from "./types";

export const METRIC_RANGES: readonly MetricRange[] = ["15m", "1h", "6h", "24h"];
export const DEFAULT_METRIC_RANGE: MetricRange = "1h";

export const RANGE_SECONDS: Record<MetricRange, number> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
};

/** null for an unknown value; undefined/empty input maps to the default. */
export function parseMetricRange(value: string | null | undefined): MetricRange | null {
  if (value === null || value === undefined || value === "") return DEFAULT_METRIC_RANGE;
  return (METRIC_RANGES as readonly string[]).includes(value) ? (value as MetricRange) : null;
}

/**
 * Liara's `since` for a range. The unit is unverified [VAL]; unix seconds of the window start is assumed
 * (Prometheus style, same as the runtime-log `start`). Kept in one place so a live check changes one line.
 */
export function rangeToSince(range: MetricRange, nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) - RANGE_SECONDS[range];
}

/** Samples may be reported in ms or s; normalise to seconds. */
export const toSeconds = (t: number): number => (t > 1e11 ? Math.floor(t / 1000) : t);
