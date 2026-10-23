"use client";

import { useMemo } from "react";
import { ProbeBadge } from "@/components/canvas/probe-badge";
import { ServiceIcon } from "@/components/canvas/service-icon";
import { useShellStore } from "@/components/shell/shell-store";
import { Unavailable } from "@/components/service/app/overview/unavailable";
import { StatusDot } from "@/components/ui/status-dot";
import { isFailing, useHealthStore } from "@/lib/canvas/health-store";
import { faNumber, relativeTime } from "@/lib/i18n/format";
import { fa } from "@/lib/i18n/fa";
import { t } from "@/lib/i18n/t";
import { lastReleaseState, markersForSeries } from "@/lib/observability/markers";
import {
  bucketSeconds,
  currentValue,
  displayValue,
  limitValue,
  sectionTotals,
  stackServices,
  statsOfSeries,
  usageRatio,
  type Point,
  type ResourceKey,
} from "@/lib/observability/series";
import type { ObsServiceDto } from "@/lib/observability/types";
import { bytesToMiB } from "@/lib/service/app-read/chart-data";
import type { MetricRange } from "@/lib/service/app-read/types";
import { AnimatedNumber } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { ObsAreaChart, ObsLegend } from "./obs-chart";
import { UsageMeter } from "./usage-meter";

const m = fa.appOps.metrics;
const fmt = (n: number, digits = 2) => faNumber(n, { maximumFractionDigits: digits });
const round = (n: number) => Number(n.toFixed(2));

/** Text alternative of a mini chart: name, unit and min / average / max over everything drawn. */
function describe(name: string, unit: string, series: ReadonlyArray<{ points: ReadonlyArray<{ v: number }> }>): string {
  const s = statsOfSeries(series);
  return s ? t("observability.chart.summary", { name, unit, min: round(s.min), avg: round(s.avg), max: round(s.max) }) : t("observability.chart.summaryEmpty", { name });
}

interface MiniProps {
  service: ObsServiceDto;
  title: string;
  unit: string;
  lines: Array<{ id: string; label: string; color: string; points: Point[] }>;
  empty: boolean;
  unavailable: boolean;
  legend?: boolean;
}

function MiniChart({ service, title, unit, lines, empty, unavailable, legend }: MiniProps) {
  const stacked = useMemo(() => stackServices(lines), [lines]);
  const markers = useMemo(() => markersForSeries(service.releases, lines), [service.releases, lines]);
  if (unavailable) return <Unavailable />;
  if (empty) return <p className="text-xs text-muted">{m.noPoints}</p>;
  return (
    <div data-no-open>
      <ObsAreaChart rows={stacked.rows} keys={stacked.keys} unit={unit} ariaLabel={describe(title, unit, lines)} height={104} markers={markers} compact />
      {legend ? <ObsLegend keys={stacked.keys} className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted" /> : null}
    </div>
  );
}

function ResourceBlock({
  service,
  resource,
  title,
  unit,
  color,
  bucket,
}: {
  service: ObsServiceDto;
  resource: ResourceKey;
  title: string;
  unit: string;
  color: string;
  bucket: number;
}) {
  const metrics = service.metrics;
  const section = metrics.unavailable ? undefined : metrics[resource];
  const points = useMemo(() => (section ? sectionTotals(section, bucket, resource === "memory" ? bytesToMiB : undefined) : []), [section, bucket, resource]);
  const lines = useMemo(() => [{ id: resource, label: title, color, points }], [resource, title, color, points]);
  const raw = currentValue(metrics, resource);
  const value = raw === undefined ? undefined : displayValue(resource, raw);
  const limit = limitValue(metrics, resource);
  const ratio = usageRatio(value, limit);
  const digits = resource === "cpu" ? 2 : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h4 className="text-sm font-medium text-muted">{title}</h4>
        <p className="text-sm" data-testid={`obs-current-${resource}`}>
          {value === undefined ? (
            <span className="text-xs text-muted">{t("observability.widgets.currentUnknown")}</span>
          ) : (
            <>
              <AnimatedNumber value={value} format={(n) => fmt(n, digits)} className="text-[17px] font-bold" /> <span className="text-xs text-muted">{unit}</span>
            </>
          )}
        </p>
      </div>
      {value !== undefined ? (
        limit !== undefined && ratio !== undefined ? (
          <UsageMeter
            ratio={ratio}
            label={t("observability.widgets.meter", { name: title })}
            valueText={t("observability.widgets.percent", { value: faNumber(Math.round(ratio * 100)) })}
            caption={t("observability.widgets.ofLimit", { limit: fmt(limit, digits), unit })}
          />
        ) : (
          <p className="text-xs text-muted">{t("observability.widgets.noLimit")}</p>
        )
      ) : null}
      <MiniChart service={service} title={title} unit={unit} lines={lines} empty={points.length === 0} unavailable={section?.unavailable ?? true} />
    </div>
  );
}

function NetworkBlock({ service, bucket }: { service: ObsServiceDto; bucket: number }) {
  const metrics = service.metrics;
  const lines = useMemo(() => {
    if (metrics.unavailable) return [];
    return [
      // Two series, not statuses: the first two categorical slots (never the ok/warn status colours).
      { id: "rx", label: m.networkRx, color: "var(--series-1)", points: sectionTotals(metrics.networkRx, bucket) },
      { id: "tx", label: m.networkTx, color: "var(--series-2)", points: sectionTotals(metrics.networkTx, bucket) },
    ];
  }, [metrics, bucket]);
  const both = !metrics.unavailable && metrics.networkRx.unavailable && metrics.networkTx.unavailable;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-muted">{m.network}</h4>
      <MiniChart
        service={service}
        title={m.network}
        unit={m.netUnit}
        lines={lines.filter((l) => l.points.length > 0)}
        empty={lines.every((l) => l.points.length === 0)}
        unavailable={metrics.unavailable || both}
        legend
      />
    </div>
  );
}

/** One service: identity, status (icon + text), CPU / RAM meters vs plan limit, mini charts with deployment markers. */
export function ServiceWidget({ service, color, range }: { service: ObsServiceDto; color: string; range: MetricRange }) {
  const health = useHealthStore((s) => s.byService[service.id]);
  const failing = isFailing(health);
  const bucket = bucketSeconds(range);
  const open = () => useShellStore.getState().openService(service.id);
  const bad = service.status === "failed" || service.status === "unhealthy" || failing;
  const hasMarkers = service.releases.length > 0;
  const releaseState = lastReleaseState(service);

  return (
    <article
      data-testid={`obs-widget-${service.name}`}
      data-service={service.id}
      aria-label={service.name}
      onClick={(e) => {
        // Charts keep their own hover; every other click on the card opens the panel (the header button is the keyboard path).
        if (!(e.target as HTMLElement).closest("[data-no-open],button,a,input")) open();
      }}
      className={cn(
        "group/widget flex cursor-pointer flex-col gap-4 rounded-md border bg-surface p-4",
        "transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]",
        bad
          ? "border-danger/60 shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_30%,transparent),0_8px_28px_color-mix(in_oklab,var(--danger)_10%,transparent)]"
          : "border-border hover:border-border-strong/60",
      )}
    >
      <header className="flex items-start gap-2.5">
        <ServiceIcon kind={service.kind} platformOrEngine={service.platformOrEngine} className="rounded-sm" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={open}
            aria-label={t("observability.widgets.open", { name: service.name })}
            className="flex max-w-full items-center gap-2 rounded text-start text-[15px] font-semibold leading-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden className="h-1 w-3 shrink-0 rounded-full" style={{ background: color }} />
            <bdi dir="ltr" className="truncate">
              {service.name}
            </bdi>
          </button>
          <p className="truncate text-xs leading-5 text-muted">
            {service.kind === "db" ? t("observability.widgets.database") : t("observability.widgets.app")} · <bdi dir="ltr">{service.platformOrEngine}</bdi>
            {service.planId ? (
              <>
                {" · "}
                {t("observability.widgets.plan")} <bdi dir="ltr">{service.planId}</bdi>
              </>
            ) : null}
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-y border-border/70 py-2.5">
        <StatusDot status={service.status} />
        <ProbeBadge health={health} kind={service.kind} />
      </div>
      {service.kind === "app" ? (
        <p className="text-xs text-muted">
          {t("observability.widgets.lastRelease")}:{" "}
          <span data-testid="obs-last-release">
            {releaseState === "known"
              ? relativeTime(service.lastReleaseAt!)
              : releaseState === "none"
                ? t("observability.widgets.noRelease")
                : t("observability.widgets.releasesUnknown")}
          </span>
        </p>
      ) : null}
      {service.metrics.unavailable ? (
        <div className="rounded-sm border border-dashed border-border bg-surface-muted/40 p-3" data-testid="obs-widget-unavailable">
          <p className="text-sm font-medium">{t("observability.widgets.metricsUnavailable")}</p>
          <p className="mt-1 text-xs leading-6 text-muted">{t("observability.widgets.metricsUnavailableHint")}</p>
        </div>
      ) : (
        <>
          <ResourceBlock service={service} resource="cpu" title={m.cpu} unit={m.cpuUnit} color={color} bucket={bucket} />
          <ResourceBlock service={service} resource="memory" title={m.memory} unit={m.memUnit} color={color} bucket={bucket} />
          <NetworkBlock service={service} bucket={bucket} />
          {hasMarkers ? <p className="text-xs text-muted">{t("observability.widgets.markersNote")}</p> : null}
        </>
      )}
    </article>
  );
}
