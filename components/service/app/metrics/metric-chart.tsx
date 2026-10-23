"use client";

import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { t } from "@/lib/i18n/t";
import type { ChartMarker } from "@/lib/observability/markers";
import { mergeSeries } from "@/lib/service/app-read/chart-data";
import { plainNumber } from "@/lib/service/app-read/format";
import type { MetricSeriesDto, MetricSeriesSection } from "@/lib/service/app-read/types";
import { Unavailable } from "../overview/unavailable";

const m = fa.appOps.metrics;
const COLORS = ["var(--accent)", "var(--warn)", "var(--ok)", "var(--danger)"];

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tehran" });
const clockSec = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Asia/Tehran" });
const tickTime = (sec: number) => clock.format(new Date(sec * 1000));

export interface ChartSeries {
  label: string;
  points: MetricSeriesDto["points"];
}

/** Flattens sections (one per metric) into labelled series; unavailable sections are skipped. */
export function toChartSeries(sections: Array<{ name?: string; section: MetricSeriesSection; map?: (v: number) => number }>): ChartSeries[] {
  return sections.flatMap(({ name, section, map }) =>
    section.unavailable
      ? []
      : section.series.map((s, i) => ({
          label: [name, s.applet ?? (section.series.length > 1 ? `#${i + 1}` : undefined)].filter(Boolean).join(" · ") || "—",
          points: map ? s.points.map((p) => ({ t: p.t, v: map(p.v) })) : s.points,
        })),
  );
}

export interface ChartKey {
  key: string;
  label: string;
  color: string;
}

/**
 * The chart itself (always LTR, text alternative via `ariaLabel`). Rows are `{t, <key>: value}` with `t` in unix seconds.
 * `markers` draw vertical dashed lines (deployment times); a marker outside the data's time range is not drawn.
 * `stacked` stacks the keys on top of each other (used for totals across services).
 */
export function MetricAreaChart({
  rows,
  keys,
  unit,
  ariaLabel,
  limit,
  height = 200,
  markers,
  stacked = false,
  compact = false,
}: {
  rows: Array<Record<string, number>>;
  keys: ChartKey[];
  unit: string;
  ariaLabel: string;
  limit?: number;
  height?: number;
  markers?: readonly ChartMarker[];
  stacked?: boolean;
  compact?: boolean;
}) {
  const tick = { fontSize: compact ? 10 : 11, fill: "var(--muted)" };
  const labelled = (markers ?? []).some((mk) => mk.showLabel);
  return (
    <>
      <div dir="ltr" role="img" aria-label={ariaLabel} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={rows} margin={{ top: labelled ? 18 : 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickTime} tick={tick} minTickGap={compact ? 40 : 32} />
            <YAxis
              width={compact ? 40 : 52}
              tick={tick}
              tickFormatter={(v: number) => plainNumber(v, 1)}
              domain={[0, (max: number) => Math.max(max, limit ?? 0) || 1]}
            />
            <Tooltip
              isAnimationActive={false}
              contentStyle={{ direction: "ltr", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(v) => clockSec.format(new Date(Number(v) * 1000))}
              formatter={(value, name) => [`${plainNumber(Number(value), 3)} ${unit}`, String(name)]}
            />
            {limit !== undefined ? (
              <ReferenceLine y={limit} stroke="var(--danger)" strokeDasharray="5 4" label={{ value: `${m.limit}: ${plainNumber(limit, 0)}`, fill: "var(--danger)", fontSize: 11, position: "insideTopRight" }} />
            ) : null}
            {(markers ?? []).map((mk) => (
              <ReferenceLine
                key={`${mk.id}-${mk.t}`}
                x={mk.t}
                stroke="var(--muted)"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={mk.showLabel ? { value: mk.label, fill: "var(--muted)", fontSize: 10, position: "top" } : undefined}
              />
            ))}
            {keys.map((k) => (
              <Area
                key={k.key}
                type="monotone"
                dataKey={k.key}
                name={k.label}
                stackId={stacked ? "stack" : undefined}
                stroke={k.color}
                fill={k.color}
                fillOpacity={stacked ? 0.55 : 0.12}
                strokeWidth={stacked ? 1.5 : 2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {markers?.length ? (
        <ul className="sr-only">
          {markers.map((mk) => (
            <li key={`${mk.id}-${mk.t}`}>{t("observability.widgets.markerRelease", { time: mk.label })}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Area chart (always LTR) with an accessible table alternative. No data => explicit empty/unavailable text. */
export function MetricChart({
  title,
  unit,
  series,
  unavailable,
  limit,
  height = 200,
  markers,
}: {
  title: string;
  unit: string;
  series: ChartSeries[];
  unavailable?: boolean;
  /** Plan limit in the same unit as the series, when known. */
  limit?: number;
  height?: number;
  /** Deployment markers (see lib/observability/markers.ts); drawn as vertical dashed lines labelled with the release time. */
  markers?: readonly ChartMarker[];
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const merged = useMemo(() => mergeSeries(series), [series]);
  const hasData = merged.rows.length > 0;

  return (
    <Card>
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
        {unavailable ? (
          <Unavailable hint />
        ) : !hasData ? (
          <p className="text-sm text-muted">{m.noPoints}</p>
        ) : (
          <MetricAreaChart
            rows={merged.rows}
            keys={merged.keys.map((k, i) => ({ ...k, color: COLORS[i % COLORS.length]! }))}
            unit={unit}
            ariaLabel={t("appOps.metrics.chartLabel", { name: title })}
            limit={limit}
            height={height}
            markers={markers}
          />
        )}
        {hasData && merged.keys.length > 1 ? (
          <ul dir="ltr" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {merged.keys.map((k, i) => (
              <li key={k.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                <span>{k.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {hasData && showTable ? (
          <div id={tableId} dir="ltr" className="mt-3 max-h-64 overflow-auto rounded-lg border border-border">
            <table className="w-full text-start font-mono text-xs" aria-label={t("appOps.metrics.tableLabel", { name: title })}>
              <thead className="sticky top-0 bg-surface-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-start">{m.time}</th>
                  {merged.keys.map((k) => (
                    <th key={k.key} scope="col" className="px-2 py-1.5 text-start">{k.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...merged.rows].reverse().map((row) => (
                  <tr key={row.t} className="border-t border-border">
                    <td className="px-2 py-1">{clockSec.format(new Date(row.t! * 1000))}</td>
                    {merged.keys.map((k) => (
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
