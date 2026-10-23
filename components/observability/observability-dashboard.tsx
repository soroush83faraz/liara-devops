"use client";

import { Network, Pause, Play, RefreshCw } from "lucide-react";
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
import { ApiError } from "@/lib/service/app-read/client";
import { DEFAULT_METRIC_RANGE } from "@/lib/service/app-read/metrics-range";
import type { MetricRange } from "@/lib/service/app-read/types";
import { AggregateCharts } from "./aggregate-charts";
import { ErrorsPanel } from "./errors-panel";
import { RangePicker } from "./range-picker";
import { ServiceFilter } from "./service-filter";
import { ServiceWidget } from "./service-widget";
import { SummaryRow } from "./summary-row";

const ALL = "__all__";

export function ObservabilitySkeleton() {
  return (
    <div aria-busy="true" aria-label={t("observability.loading")} className="flex flex-col gap-4" data-testid="obs-skeleton">
      <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-96 rounded-xl" />
        ))}
      </div>
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold leading-9">{t("observability.title")}</h1>
        <p className="text-sm leading-7 text-muted">{t("observability.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3" data-testid="obs-controls">
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
              <ServiceFilter services={data.services} hidden={hiddenSet} onToggle={toggleService} onShowAll={() => updateHidden([])} />
              {visible.length === 0 ? (
                <EmptyState title={t("observability.empty.allHiddenTitle")} description={t("observability.empty.allHiddenBody")} />
              ) : (
                <>
                  <SummaryRow summary={summary} />
                  <AggregateCharts services={visible} range={data.range} colorOf={color} />
                  <section aria-labelledby="obs-widgets-title" className="flex flex-col gap-3">
                    <h2 id="obs-widgets-title" className="text-lg font-semibold leading-8">
                      {t("observability.widgets.title")}{" "}
                      <span className="text-sm font-normal text-muted">({faNumber(visible.length)})</span>
                    </h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="obs-widget-grid">
                      {visible.map((s) => (
                        <ServiceWidget key={s.id} service={s} color={color(s.id)} range={data.range} />
                      ))}
                    </div>
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
