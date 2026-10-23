import { MetricSeriesSchema, MetricsSummarySchema, type MetricSeries, type MetricsSummary } from "./schemas";
import type { LiaraClient } from "./core";
import { seg } from "./util";

export type MetricName = "cpu" | "memory" | "network-receive" | "network-transmit";

export interface MetricPoint {
  /** Sample time as reported (unix seconds, Prometheus style) [VAL]. */
  t: number;
  v: number;
}
export interface NormalizedSeries {
  applet?: string;
  points: MetricPoint[];
}

/** [V] GET /v1/projects/{name}/metrics/summary: `{cpuUsage, memoryUsage, disksUsage}`; units unverified [VAL]. */
export function getAppMetricsSummary(client: LiaraClient, name: string): Promise<MetricsSummary> {
  return client.get(`/v1/projects/${seg(name)}/metrics/summary`, MetricsSummarySchema);
}

/**
 * [V] GET /v1/projects/{name}/metrics/{cpu|memory|network-receive|network-transmit}?since=
 * `since` is a required number; its unit/window is unverified [VAL] (passed through untouched).
 */
export function getAppMetricSeries(client: LiaraClient, name: string, metric: MetricName, since: number): Promise<MetricSeries> {
  return client.get(`/v1/projects/${seg(name)}/metrics/${metric}`, MetricSeriesSchema, { query: { since } });
}

/** Flatten `result[].values[[t, v]]` into numeric points, dropping non-numeric samples. */
export function normalizeSeries(series: MetricSeries): NormalizedSeries[] {
  return series.result.map((r) => ({
    applet: r.applet,
    points: r.values
      .map(([t, v]) => ({ t: Number(t), v: Number(v) }))
      .filter((pt) => Number.isFinite(pt.t) && Number.isFinite(pt.v)),
  }));
}

/** Latest numeric value per applet from a summary array (`value: [ts, "0.12"]`). */
export function latestUsage(samples: MetricsSummary["cpuUsage"]): Array<{ applet?: string; value: number }> {
  return samples
    .map((s) => ({ applet: s.applet, value: Number(s.value.at(-1)) }))
    .filter((s) => Number.isFinite(s.value));
}
