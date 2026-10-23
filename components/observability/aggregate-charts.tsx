"use client";

import { Table2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button, Card } from "@/components/ui";
import { Unavailable } from "@/components/service/app/overview/unavailable";
import { fa } from "@/lib/i18n/fa";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { bucketSeconds, OTHER_SERIES_COLOR, sectionTotals, seriesStats, stackServices, type Point, type StackedRows } from "@/lib/observability/series";
import type { ObsServiceDto } from "@/lib/observability/types";
import { bytesToMiB } from "@/lib/service/app-read/chart-data";
import { chartNumber, chartTimeSec } from "@/lib/ui/chart-axis";
import type { MetricRange } from "@/lib/service/app-read/types";
import { ease } from "@/lib/ui/motion";
import { ObsAreaChart, ObsLegend } from "./obs-chart";

const m = fa.appOps.metrics;

function AggregateChart({ title, unit, stacked }: { title: string; unit: string; stacked: StackedRows }) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const hasData = stacked.rows.length > 0;
  const totals = useMemo(
    () => stacked.rows.map((r) => stacked.keys.reduce((sum, k) => sum + (r[k.key] ?? 0), 0)),
    [stacked],
  );
  const stats = seriesStats(totals);
  const round = (n: number) => Number(n.toFixed(2));
  const ariaLabel = stats
    ? t("observability.chart.summary", { name: title, unit, min: round(stats.min), avg: round(stats.avg), max: round(stats.max) })
    : t("observability.chart.summaryEmpty", { name: title });

  return (
    <Card data-testid="obs-aggregate-chart" className="flex flex-col gap-3 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-snug">
            {title} <span className="text-sm font-normal text-muted">({unit})</span>
          </h3>
          {stats ? (
            <dl className="mt-1 flex items-baseline gap-4 text-xs text-muted">
              <div className="flex items-baseline gap-1.5">
                <dt>{t("observability.chart.avg")}</dt>
                <dd className="font-semibold text-foreground" data-numeric>{faNumber(stats.avg, { maximumFractionDigits: 2 })}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt>{t("observability.chart.peak")}</dt>
                <dd className="font-semibold text-foreground" data-numeric>{faNumber(stats.max, { maximumFractionDigits: 2 })}</dd>
              </div>
            </dl>
          ) : null}
        </div>
        {hasData ? (
          <Button variant="ghost" size="sm" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((s) => !s)} className="text-muted hover:text-foreground">
            <Table2 aria-hidden className="size-4" />
            {showTable ? m.hideTable : m.showTable}
          </Button>
        ) : null}
      </header>
      {!hasData ? (
        <p className="text-sm text-muted">{t("observability.aggregate.noData")}</p>
      ) : (
        <>
          <ObsAreaChart rows={stacked.rows} keys={stacked.keys} unit={unit} ariaLabel={ariaLabel} height={220} stacked />
          <ObsLegend keys={stacked.keys} label={t("observability.aggregate.legend")} stacked />
        </>
      )}
      <AnimatePresence initial={false}>
        {hasData && showTable ? (
          <motion.div
            key="table"
            id={tableId}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: ease.out }}
            className="max-h-64 overflow-auto rounded-sm border border-border"
          >
            <table className="w-full text-start text-xs tabular-nums" aria-label={t("observability.chart.table", { name: title })}>
              <thead className="sticky top-0 bg-surface-muted text-muted">
                <tr>
                  <th scope="col" className="px-2.5 py-1.5 text-start font-medium">{m.time}</th>
                  {stacked.keys.map((k) => (
                    <th key={k.key} scope="col" className="px-2.5 py-1.5 text-start font-medium">{k.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...stacked.rows].reverse().map((row) => (
                  <tr key={row.t} className="border-t border-border hover:bg-surface-muted/60">
                    <td className="px-2.5 py-1 text-muted">{chartTimeSec(row.t!)}</td>
                    {stacked.keys.map((k) => (
                      <td key={k.key} className="px-2.5 py-1 tabular-nums">{row[k.key] === undefined ? "—" : chartNumber(row[k.key]!, 3)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}

type Line = { id: string; label: string; color: string; points: Point[] };

/** Services past the eighth palette slot share one neutral «سایر» band (summed per bucket) instead of a made-up hue. */
function foldOthers(lines: Line[]): Line[] {
  const named = lines.filter((l) => l.color !== OTHER_SERIES_COLOR);
  const rest = lines.filter((l) => l.color === OTHER_SERIES_COLOR && l.points.length > 0);
  if (rest.length === 0) return named;
  const sum = new Map<number, number>();
  for (const l of rest) for (const p of l.points) sum.set(p.t, (sum.get(p.t) ?? 0) + p.v);
  const points = [...sum.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
  return [...named, { id: "__other__", label: t("observability.aggregate.other"), color: OTHER_SERIES_COLOR, points }];
}

/** Total CPU and memory across the shown services, one colour (and one named legend entry) per service. */
export function AggregateCharts({ services, range, colorOf }: { services: readonly ObsServiceDto[]; range: MetricRange; colorOf: (id: string) => string }) {
  const { cpu, memory, anyAvailable } = useMemo(() => {
    const bucket = bucketSeconds(range);
    const lines = (pick: "cpu" | "memory") =>
      foldOthers(
        services.flatMap((s) =>
          s.metrics.unavailable
            ? []
            : [{ id: s.id, label: s.name, color: colorOf(s.id), points: sectionTotals(s.metrics[pick], bucket, pick === "memory" ? bytesToMiB : undefined) }],
        ),
      );
    return {
      cpu: stackServices(lines("cpu")),
      memory: stackServices(lines("memory")),
      anyAvailable: services.some((s) => !s.metrics.unavailable),
    };
  }, [services, range, colorOf]);

  return (
    <section aria-labelledby="obs-aggregate-title" className="flex flex-col gap-3">
      <h2 id="obs-aggregate-title" className="text-lg font-bold">
        {t("observability.aggregate.title")}
      </h2>
      {anyAvailable ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <AggregateChart title={t("observability.aggregate.cpu")} unit={m.cpuUnit} stacked={cpu} />
            <AggregateChart title={t("observability.aggregate.memory")} unit={m.memUnit} stacked={memory} />
          </div>
          <p className="text-xs leading-6 text-muted">{t("observability.aggregate.note")}</p>
        </>
      ) : (
        <Unavailable hint />
      )}
      <p className="text-xs leading-6 text-muted">{m.unitsNote}</p>
    </section>
  );
}
