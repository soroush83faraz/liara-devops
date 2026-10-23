import { normalizeSeries, type MetricSeries, type NormalizedSeries } from "../../liara";
import { toSeconds } from "./metrics-range";
import type { MetricRange, MetricSeriesSection, MetricsDto, MetricsUnavailableDto, UsageDto } from "./types";
import type { Part } from "./overview";
import { downsample } from "./chart-data";

export function toSection(p: Part<MetricSeries>): MetricSeriesSection {
  if (!p.ok) return { unavailable: true };
  const series = normalizeSeries(p.value)
    .map((s: NormalizedSeries) => ({
      ...(s.applet ? { applet: s.applet } : {}),
      points: downsample(
        s.points.map((pt) => ({ t: toSeconds(pt.t), v: pt.v })).sort((a, b) => a.t - b.t),
      ),
    }))
    .filter((s) => s.points.length > 0);
  return { unavailable: false, series };
}

const hasData = (s: MetricSeriesSection) => !s.unavailable && s.series.length > 0;

export interface MetricsParts {
  range: MetricRange;
  since: number;
  cpu: Part<MetricSeries>;
  memory: Part<MetricSeries>;
  networkRx: Part<MetricSeries>;
  networkTx: Part<MetricSeries>;
  current?: UsageDto;
  limits?: MetricsDto["limits"];
}

/** Metrics response or an explicit unavailable marker; never invents data. */
export function assembleMetrics(p: MetricsParts): MetricsDto | MetricsUnavailableDto {
  const cpu = toSection(p.cpu);
  const memory = toSection(p.memory);
  const networkRx = toSection(p.networkRx);
  const networkTx = toSection(p.networkTx);
  const all = [cpu, memory, networkRx, networkTx];
  if (all.every((s) => s.unavailable)) return { unavailable: true, reason: "request_failed", range: p.range };
  if (!all.some(hasData) && !p.current) return { unavailable: true, reason: "empty", range: p.range };
  return {
    range: p.range,
    since: p.since,
    unitsVerified: false,
    cpu,
    memory,
    networkRx,
    networkTx,
    ...(p.limits ? { limits: p.limits } : {}),
    ...(p.current ? { current: p.current } : {}),
  };
}
