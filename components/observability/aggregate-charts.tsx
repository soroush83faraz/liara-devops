"use client";

import { useId, useMemo, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { MetricAreaChart } from "@/components/service/app/metrics/metric-chart";
import { Unavailable } from "@/components/service/app/overview/unavailable";
import { fa } from "@/lib/i18n/fa";
import { t } from "@/lib/i18n/t";
import { bucketSeconds, sectionTotals, seriesStats, stackServices, type StackedRows } from "@/lib/observability/series";
import type { ObsServiceDto } from "@/lib/observability/types";
import { bytesToMiB } from "@/lib/service/app-read/chart-data";
import { plainNumber } from "@/lib/service/app-read/format";
import type { MetricRange } from "@/lib/service/app-read/types";

const m = fa.appOps.metrics;
const clockSec = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Asia/Tehran" });

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
    <Card data-testid="obs-aggregate-chart">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>
          {title} <span className="text-sm font-normal text-muted">({unit})</span>
        </CardTitle>
        {hasData ? (
          <Button variant="ghost" size="sm" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((s) => !s)}>
            {showTable ? m.hideTable : m.showTable}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted">{t("observability.aggregate.noData")}</p>
        ) : (
          <>
            <MetricAreaChart rows={stacked.rows} keys={stacked.keys} unit={unit} ariaLabel={ariaLabel} height={220} stacked />
            <ul aria-label={t("observability.aggregate.legend")} dir="ltr" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {stacked.keys.map((k) => (
                <li key={k.key} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-sm" style={{ background: k.color }} />
                  <span>{k.label}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {hasData && showTable ? (
          <div id={tableId} dir="ltr" className="mt-3 max-h-64 overflow-auto rounded-lg border border-border">
            <table className="w-full text-start font-mono text-xs" aria-label={t("observability.chart.table", { name: title })}>
              <thead className="sticky top-0 bg-surface-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-start">{m.time}</th>
                  {stacked.keys.map((k) => (
                    <th key={k.key} scope="col" className="px-2 py-1.5 text-start">{k.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...stacked.rows].reverse().map((row) => (
                  <tr key={row.t} className="border-t border-border">
                    <td className="px-2 py-1">{clockSec.format(new Date(row.t! * 1000))}</td>
                    {stacked.keys.map((k) => (
                      <td key={k.key} className="px-2 py-1 tabular-nums">{row[k.key] === undefined ? "—" : plainNumber(row[k.key]!, 3)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Total CPU and memory across the shown services, one colour (and one named legend entry) per service. */
export function AggregateCharts({ services, range, colorOf }: { services: readonly ObsServiceDto[]; range: MetricRange; colorOf: (id: string) => string }) {
  const { cpu, memory, anyAvailable } = useMemo(() => {
    const bucket = bucketSeconds(range);
    const lines = (pick: "cpu" | "memory") =>
      services.flatMap((s) =>
        s.metrics.unavailable
          ? []
          : [{ id: s.id, label: s.name, color: colorOf(s.id), points: sectionTotals(s.metrics[pick], bucket, pick === "memory" ? bytesToMiB : undefined) }],
      );
    return {
      cpu: stackServices(lines("cpu")),
      memory: stackServices(lines("memory")),
      anyAvailable: services.some((s) => !s.metrics.unavailable),
    };
  }, [services, range, colorOf]);

  return (
    <section aria-labelledby="obs-aggregate-title" className="flex flex-col gap-3">
      <h2 id="obs-aggregate-title" className="text-lg font-semibold leading-8">
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
