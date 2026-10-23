"use client";

import { Network, Pause, Play, RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { QueryErrorBanner } from "@/components/service/app/overview/unavailable";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { isFailing, useHealthStore } from "@/lib/canvas/health-store";
import { useOverview } from "@/lib/canvas/use-overview";
import { useProbe } from "@/lib/canvas/use-probe";
import { faNumber, faTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { loadHidden, saveHidden } from "@/lib/observability/prefs";
import { colorForIndex } from "@/lib/observability/series";
import { summarize } from "@/lib/observability/summary";
import { useObservability } from "@/lib/observability/use-observability";
import { fadeUp, Pulse, stagger } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/service/app-read/client";
import { DEFAULT_METRIC_RANGE } from "@/lib/service/app-read/metrics-range";
import type { MetricRange } from "@/lib/service/app-read/types";
import { AggregateCharts } from "./aggregate-charts";
import { ErrorsPanel } from "./errors-panel";
import { RangePicker } from "./range-picker";
import { ServiceFilter } from "./service-filter";
import { ServiceWidget } from "./service-widget";
import { useMediaQuery } from "@/components/shell/use-media-query";
import type { ObsServiceDto } from "@/lib/observability/types";
import { SummaryRow } from "./summary-row";

const ALL = "__all__";

/** Rough relative card heights: a card without metrics is a short notice, the rest carry three charts. */
const widgetWeight = (s: ObsServiceDto) => (s.metrics.unavailable ? 1 : s.kind === "app" ? 3.2 : 3);

/**
 * Service cards in masonry columns: each card goes under the currently shortest column (ties: the reading-start
 * one), so a short «metrics unavailable» card no longer leaves a row-tall hole beside two full cards. Reading order
 * stays close to the list order (the first N cards open the N columns).
 */
function WidgetColumns({ services, color, range }: { services: ObsServiceDto[]; color: (id: string) => string; range: MetricRange }) {
  const md = useMediaQuery("(min-width: 768px)");
  const xl = useMediaQuery("(min-width: 1280px)");
  const count = xl ? 3 : md ? 2 : 1;
  const columns = useMemo(() => {
    const cols = Array.from({ length: count }, () => ({ height: 0, items: [] as Array<{ service: ObsServiceDto; index: number }> }));
    services.forEach((service, index) => {
      const target = cols.reduce((best, c) => (c.height < best.height - 1e-9 ? c : best), cols[0]);
      target.items.push({ service, index });
      target.height += widgetWeight(service);
    });
    return cols;
  }, [services, count]);
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={stagger(0.05)}
      className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3"
      data-testid="obs-widget-grid"
    >
      {columns.map((col, c) => (
        <div key={c} className="flex min-w-0 flex-col gap-4">
          {col.items.map(({ service, index }) => (
            <motion.div key={service.id} variants={index < 12 ? fadeUp : undefined} className="min-w-0">
              <ServiceWidget service={service} color={color(service.id)} range={range} />
            </motion.div>
          ))}
        </div>
      ))}
    </motion.div>
  );
}

export function ObservabilitySkeleton() {
  return (
    <div aria-busy="true" aria-label={t("observability.loading")} className="flex flex-col gap-6" data-testid="obs-skeleton">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cn("flex flex-col gap-2.5 bg-surface p-4", (i === 0 || i === 3) && "col-span-2 lg:col-span-1")}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
            <ChartSkeleton className="h-52" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-9" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <Skeleton className="h-6 w-36 rounded-full" />
            <Skeleton className="h-1.5 w-full rounded-full" />
            <ChartSkeleton className="h-24" />
            <Skeleton className="h-1.5 w-full rounded-full" />
            <ChartSkeleton className="h-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Hairline grid with a shimmering baseline: reads as "a chart is coming" rather than a grey slab. */
function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative flex flex-col justify-between", className)}>
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="h-px w-full bg-border" />
      ))}
      <Skeleton className="absolute inset-x-0 bottom-0 h-2/5 rounded-none opacity-70 [clip-path:polygon(0_70%,12%_45%,25%_60%,38%_30%,52%_50%,66%_20%,80%_42%,100%_25%,100%_100%,0_100%)]" />
    </div>
  );
}

export function ObservabilityDashboard({ accountId }: { accountId: string }) {
  const [range, setRange] = useState<MetricRange>(DEFAULT_METRIC_RANGE);
  const [network, setNetwork] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  useEffect(() => {
    // Per-account, per-device preference; read after mount so server and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(loadHidden(accountId));
  }, [accountId]);

  const overview = useOverview();
  useProbe(overview.data?.services);
  const { metrics, errors } = useObservability({ accountId, range, network, paused });
  const probes = useHealthStore((s) => s.byService);

  const data = metrics.data;
  const color = useMemo(() => {
    const ids = (data?.services ?? []).map((s) => s.id).sort();
    const index = new Map(ids.map((id, i) => [id, i]));
    return (id: string) => colorForIndex(index.get(id) ?? 0);
  }, [data?.services]);

  const visible = useMemo(() => (data?.services ?? []).filter((s) => !hiddenSet.has(s.id)), [data?.services, hiddenSet]);
  const visibleIds = useMemo(() => new Set(visible.map((s) => s.id)), [visible]);

  // Only services whose scan SUCCEEDED get an entry: a failed scan is "unknown", never a count of 0.
  const scanCounts = useMemo(() => {
    if (!errors.data) return null;
    const m = new Map<string, number>();
    for (const e of errors.data.entries) if (!e.unavailable) m.set(e.id, e.count);
    return m;
  }, [errors.data]);
  const summary = summarize(visible, (id) => isFailing(probes[id]), scanCounts, data ? data.truncated.total - data.truncated.shown : 0);

  const updateHidden = useCallback(
    (next: string[]) => {
      setHidden(next);
      saveHidden(accountId, next);
    },
    [accountId],
  );
  const toggleService = (id: string, show: boolean) => updateHidden(show ? hidden.filter((h) => h !== id) : [...hidden, id]);

  const refreshAll = () => {
    void metrics.refetch();
    void errors.refetch();
  };
  const fetching = metrics.isFetching || errors.isFetching;
  const networkOptions = [{ value: ALL, label: t("observability.controls.allNetworks") }, ...(data?.networks ?? []).map((n) => ({ value: n.id, label: n.name }))];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("observability.title")}</h1>
        <p className="text-sm text-muted">{t("observability.subtitle")}</p>
      </header>

      <div
        className="-mx-4 flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-border px-4 pb-4 sm:-mx-6 sm:px-6 lg:sticky lg:top-0 lg:z-20 lg:bg-background/92 lg:py-3 lg:backdrop-blur-sm"
        data-testid="obs-controls"
      >
        <RangePicker value={range} onChange={setRange} />
        <div className="w-full min-[460px]:w-56">
          <Select
            aria-label={t("observability.controls.network")}
            value={network ?? ALL}
            onValueChange={(v) => setNetwork(v === ALL ? null : v)}
            options={networkOptions}
          />
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Pulse tone={paused ? "muted" : "accent"} active={!paused && !fetching} hollow={paused} />
          <p className="text-xs text-muted" role="status" data-testid="obs-updated">
            {metrics.dataUpdatedAt ? t("observability.refresh.lastUpdated", { time: faTime(metrics.dataUpdatedAt) }) : null}
            {metrics.dataUpdatedAt ? " · " : null}
            {paused ? t("observability.refresh.paused") : t("observability.refresh.auto")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={paused}
            aria-label={paused ? t("observability.refresh.resumeLabel") : t("observability.refresh.pauseLabel")}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
            {paused ? t("observability.refresh.resume") : t("observability.refresh.pause")}
          </Button>
          <Button variant="ghost" size="sm" onClick={refreshAll} loading={fetching} aria-label={t("observability.refresh.now")}>
            {fetching ? null : <RefreshCw aria-hidden className="size-4" />}
            <span className="hidden sm:inline">{t("observability.refresh.now")}</span>
          </Button>
        </div>
      </div>

      {metrics.isError && metrics.error instanceof ApiError && metrics.error.status === 401 ? (
        <div className="flex flex-wrap items-center gap-3">
          <ErrorBanner tone="warn" message={t("observability.reconnect")} className="min-w-0 flex-1" />
          <Link href="/connect" className={buttonVariants({ size: "sm" })}>
            {t("canvasMap.errors.reconnectCta")}
          </Link>
        </div>
      ) : metrics.isPending ? (
        <ObservabilitySkeleton />
      ) : !data ? (
        <QueryErrorBanner error={metrics.error} onRetry={refreshAll} retrying={fetching} />
      ) : (
        <>
          {metrics.isError ? (
            <div data-testid="obs-stale-banner">
              <ErrorBanner tone="warn" message={t("observability.refreshFailed", { time: faTime(metrics.dataUpdatedAt) })} onRetry={refreshAll} retrying={fetching} />
            </div>
          ) : null}
          {data.truncated.shown < data.truncated.total ? (
            <ErrorBanner tone="warn" message={t("observability.truncated", { shown: data.truncated.shown, total: data.truncated.total })} />
          ) : null}
          <p className="text-xs leading-6 text-muted">{t("observability.noHistoryNote")}</p>

          {data.services.length === 0 ? (
            <EmptyState
              icon={<Network />}
              title={network ? t("observability.empty.filteredTitle") : t("observability.empty.title")}
              description={network ? t("observability.empty.filteredBody") : t("observability.empty.body")}
              action={
                network ? (
                  <Button variant="secondary" onClick={() => setNetwork(null)}>
                    {t("observability.controls.allNetworks")}
                  </Button>
                ) : (
                  <Link href="/" className={buttonVariants({ variant: "secondary" })}>
                    {t("observability.empty.cta")}
                  </Link>
                )
              }
            />
          ) : (
            <>
              <ServiceFilter services={data.services} hidden={hiddenSet} onToggle={toggleService} onShowAll={() => updateHidden([])} colorOf={color} />
              {visible.length === 0 ? (
                <EmptyState title={t("observability.empty.allHiddenTitle")} description={t("observability.empty.allHiddenBody")} />
              ) : (
                <>
                  <SummaryRow summary={summary} />
                  <AggregateCharts services={visible} range={data.range} colorOf={color} />
                  <section aria-labelledby="obs-widgets-title" className="flex flex-col gap-3">
                    <h2 id="obs-widgets-title" className="text-lg font-bold">
                      {t("observability.widgets.title")}{" "}
                      <span className="text-sm font-normal text-muted">({faNumber(visible.length)})</span>
                    </h2>
                    <WidgetColumns services={visible} color={color} range={data.range} />
                    <p className="text-xs leading-6 text-muted">{t("appOps.metrics.unitsNote")}</p>
                  </section>
                  <ErrorsPanel
                    data={errors.data}
                    error={errors.isError ? errors.error : null}
                    pending={errors.isPending}
                    visibleIds={visibleIds}
                    onRetry={() => void errors.refetch()}
                    retrying={errors.isFetching}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
