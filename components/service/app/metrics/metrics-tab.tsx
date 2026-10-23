"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined } from "lucide-react";
import { useState } from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { appPath, fetchJson } from "@/lib/service/app-read/client";
import { bytesToMiB } from "@/lib/service/app-read/chart-data";
import { METRIC_RANGES } from "@/lib/service/app-read/metrics-range";
import { markersForSeries } from "@/lib/observability/markers";
import type { ObsRelease } from "@/lib/observability/types";
import type { AppPanelProps, MetricRange, MetricsDto, MetricsUnavailableDto, ReleasesPageDto } from "@/lib/service/app-read/types";
import { ToggleChip } from "../logs/toggle-chip";
import { QueryErrorBanner } from "../overview/unavailable";
import { MetricChart, toChartSeries } from "./metric-chart";

const m = fa.appOps.metrics;

type MetricsResponse = MetricsDto | MetricsUnavailableDto;

function Charts({ data, releases }: { data: MetricsDto; releases: ObsRelease[] }) {
  const limitMiB = data.limits?.ramGb !== undefined ? data.limits.ramGb * 1024 : undefined;
  const cpu = toChartSeries([{ section: data.cpu }]);
  const memory = toChartSeries([{ section: data.memory, map: bytesToMiB }]);
  const network = toChartSeries([
    { name: m.networkRx, section: data.networkRx },
    { name: m.networkTx, section: data.networkTx },
  ]);
  return (
    <div className="flex flex-col gap-4">
      <MetricChart title={m.cpu} unit={m.cpuUnit} series={cpu} unavailable={data.cpu.unavailable} markers={markersForSeries(releases, cpu)} />
      <MetricChart
        title={m.memory}
        unit={m.memUnit}
        series={memory}
        unavailable={data.memory.unavailable}
        limit={limitMiB}
        markers={markersForSeries(releases, memory)}
      />
      <MetricChart
        title={m.network}
        unit={m.netUnit}
        series={network}
        unavailable={data.networkRx.unavailable && data.networkTx.unavailable}
        markers={markersForSeries(releases, network)}
      />
      <p className="text-xs leading-6 text-muted">{m.unitsNote}</p>
    </div>
  );
}

/** Newest releases as deployment markers. A failing releases call just means no markers (the charts do not depend on it). */
function useReleaseMarkers(name: string): ObsRelease[] {
  const q = useQuery({
    queryKey: ["app", name, "releases", "markers"],
    queryFn: ({ signal }) => fetchJson<ReleasesPageDto>(`${appPath(name, "releases")}?count=10`, signal),
    staleTime: 30_000,
    retry: false,
  });
  return (q.data?.releases ?? [])
    .filter((r) => r.createdAt)
    .map((r) => ({ id: r.id, at: r.createdAt!, state: r.state, ...(r.tag ? { tag: r.tag } : {}) }));
}

export function MetricsTab({ name }: AppPanelProps) {
  const [range, setRange] = useState<MetricRange>("1h");
  const releases = useReleaseMarkers(name);
  const q = useQuery({
    queryKey: ["app", name, "metrics", range],
    queryFn: ({ signal }) => fetchJson<MetricsResponse>(`${appPath(name, "metrics")}?range=${range}`, signal),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={m.range} className="flex flex-wrap items-center gap-2">
        {METRIC_RANGES.map((r) => (
          <ToggleChip key={r} pressed={range === r} onClick={() => setRange(r)}>
            {m.ranges[r]}
          </ToggleChip>
        ))}
      </div>
      {q.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-60 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      ) : q.isError ? (
        <QueryErrorBanner error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.data.unavailable ? (
        <EmptyState
          icon={<ChartNoAxesCombined />}
          title={m.unavailableTitle}
          description={`${q.data.reason === "empty" ? m.unavailableEmpty : m.unavailableRequest} ${m.unitsNote}`}
        />
      ) : (
        <Charts data={q.data} releases={releases} />
      )}
    </div>
  );
}
