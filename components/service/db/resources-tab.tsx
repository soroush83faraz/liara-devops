"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, HardDrive } from "lucide-react";
import { useState } from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import { MetricChart, toChartSeries } from "@/components/service/app/metrics/metric-chart";
import { ToggleChip } from "@/components/service/app/logs/toggle-chip";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { bytesToMiB } from "@/lib/service/app-read/chart-data";
import { METRIC_RANGES } from "@/lib/service/app-read/metrics-range";
import type { MetricRange, MetricsDto, MetricsUnavailableDto, UsageDto } from "@/lib/service/app-read/types";
import { dbKeys, dbPath, fetchJson } from "@/lib/service/db/client";
import { diskPercent } from "@/lib/service/db/disk";
import { QueryError, SectionCard, type DbPanelProps } from "./shared";

type MetricsResponse = MetricsDto | MetricsUnavailableDto;

function DiskTile({ current }: { current: UsageDto | undefined }) {
  const disks = current?.disks ?? [];
  return (
    <SectionCard title={t("dbPanel.resources.disk")} icon={<HardDrive />}>
      {disks.length === 0 ? (
        <p className="text-sm text-muted">{t("dbPanel.resources.diskNone")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {disks.map((d, i) => {
            const pct = diskPercent(d.usage, d.size);
            return (
              <li key={d.name ?? i} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {d.name ? <bdi dir="ltr" className="font-mono text-sm">{d.name}</bdi> : <span />}
                  {pct !== undefined ? <span className="text-sm font-semibold tabular-nums">{t("dbPanel.resources.diskUsed", { percent: faNumber(Math.round(pct)) })}</span> : null}
                </div>
                {pct !== undefined ? (
                  <div role="img" aria-label={t("dbPanel.resources.diskUsed", { percent: faNumber(Math.round(pct)) })} className="h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div className={pct >= 90 ? "h-full bg-danger" : pct >= 75 ? "h-full bg-warn" : "h-full bg-accent"} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                ) : null}
                {d.usage !== undefined && d.size !== undefined ? (
                  <bdi dir="ltr" className="text-xs text-muted tabular-nums">{t("dbPanel.resources.diskRaw", { usage: d.usage, size: d.size })}</bdi>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs leading-6 text-muted">{t("dbPanel.resources.diskUnit")}</p>
    </SectionCard>
  );
}

function Charts({ data }: { data: MetricsDto }) {
  const limitMiB = data.limits?.ramGb !== undefined ? data.limits.ramGb * 1024 : undefined;
  return (
    <div className="flex flex-col gap-4">
      <DiskTile current={data.current} />
      <MetricChart title={t("dbPanel.resources.cpu")} unit={t("dbPanel.resources.cpuUnit")} series={toChartSeries([{ section: data.cpu }])} unavailable={data.cpu.unavailable} />
      <MetricChart
        title={t("dbPanel.resources.memory")}
        unit={t("dbPanel.resources.memoryUnit")}
        series={toChartSeries([{ section: data.memory, map: bytesToMiB }])}
        unavailable={data.memory.unavailable}
        limit={limitMiB}
      />
      <MetricChart
        title={t("dbPanel.resources.network")}
        unit={t("dbPanel.resources.networkUnit")}
        series={toChartSeries([
          { name: t("dbPanel.resources.networkRx"), section: data.networkRx },
          { name: t("dbPanel.resources.networkTx"), section: data.networkTx },
        ])}
        unavailable={data.networkRx.unavailable && data.networkTx.unavailable}
      />
      <p className="text-xs leading-6 text-muted">{t("dbPanel.common.unitsUnverified")}</p>
    </div>
  );
}

export function DbResourcesTab({ name }: DbPanelProps) {
  const [range, setRange] = useState<MetricRange>("1h");
  const q = useQuery({
    queryKey: dbKeys.metrics(name, range),
    queryFn: ({ signal }) => fetchJson<MetricsResponse>(`${dbPath(name, "metrics")}?range=${range}`, signal),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t("dbPanel.resources.range")} className="flex flex-wrap items-center gap-2">
        {METRIC_RANGES.map((r) => (
          <ToggleChip key={r} pressed={range === r} onClick={() => setRange(r)}>
            {t(`dbPanel.resources.ranges.${r}`)}
          </ToggleChip>
        ))}
      </div>
      {q.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-60 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.data.unavailable ? (
        <EmptyState
          icon={<ChartNoAxesCombined />}
          title={t("dbPanel.resources.unavailableTitle")}
          description={`${q.data.reason === "empty" ? t("dbPanel.resources.unavailableEmpty") : t("dbPanel.resources.unavailableRequest")} ${t("dbPanel.common.unitsUnverified")}`}
        />
      ) : (
        <Charts data={q.data} />
      )}
    </div>
  );
}
