"use client";

import { useReducedMotion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { t } from "@/lib/i18n/t";
import type { ChartMarker } from "@/lib/observability/markers";
import { mergeSeries } from "@/lib/service/app-read/chart-data";
import { chartMax, chartNumber, chartTime, chartTimeSec, niceTicks, seriesDash } from "@/lib/ui/chart-axis";
import type { MetricSeriesDto, MetricSeriesSection } from "@/lib/service/app-read/types";
import { Unavailable } from "../overview/unavailable";

const m = fa.appOps.metrics;
const COLORS = ["var(--accent)", "var(--warn)", "var(--ok)", "var(--danger)"];


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
  // New samples morph the line into place (short ease-out); still under reduced motion.
  const animate = !useReducedMotion();
  const labelled = (markers ?? []).some((mk) => mk.showLabel);
  // Even, round y steps that also clear the plan limit line; Persian digits on every tick and label.
  const y = niceTicks(chartMax(rows, keys.map((k) => k.key), stacked, limit ?? 0), compact ? 2 : 4);
  return (
    <>
      <div dir="ltr" role="img" aria-label={ariaLabel} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={rows} margin={{ top: labelled ? 18 : 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={chartTime} tick={tick} minTickGap={compact ? 40 : 32} />
            <YAxis
              width={compact ? 40 : 52}
              tick={tick}
              ticks={y.ticks}
              interval={0}
              tickFormatter={(v: number) => chartNumber(v)}
              domain={[0, y.top]}
              allowDataOverflow
            />
            <Tooltip
              isAnimationActive={false}
              contentStyle={{ direction: "rtl", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(v) => chartTimeSec(Number(v))}
              formatter={(value, name) => [`${chartNumber(Number(value), 3)} ${unit}`, String(name)]}
            />
            {limit !== undefined ? (
              <ReferenceLine y={limit} stroke="var(--danger)" strokeDasharray="5 4" label={{ value: `${m.limit}: ${chartNumber(limit, 0)}`, fill: "var(--danger)", fontSize: 11, position: "insideTopRight" }} />
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
            {keys.map((k, i) => (
              <Area
                key={k.key}
                type="monotone"
                dataKey={k.key}
                name={k.label}
                stackId={stacked ? "stack" : undefined}
                stroke={k.color}
                strokeDasharray={seriesDash(i, stacked)}
                fill={k.color}
                fillOpacity={stacked ? 0.55 : 0.12}
                strokeWidth={stacked ? 1.5 : 2}
                dot={false}
                connectNulls
                isAnimationActive={animate}
                animationDuration={450}
                animationEasing="ease-out"
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
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {merged.keys.map((k, i) => (
              <li key={k.key} className="inline-flex items-center gap-1.5">
                <svg aria-hidden width="14" height="4" className="shrink-0 overflow-visible">
                  <line x1="1" y1="2" x2="13" y2="2" stroke={COLORS[i % COLORS.length]} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={seriesDash(i, false) ? "3.5 3" : undefined} />
                </svg>
                <span>{k.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {hasData && showTable ? (
          <div id={tableId} className="mt-3 max-h-64 overflow-auto rounded-sm border border-border">
            <table className="w-full text-start text-xs tabular-nums" aria-label={t("appOps.metrics.tableLabel", { name: title })}>
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
                    <td className="px-2 py-1">{chartTimeSec(row.t!)}</td>
                    {merged.keys.map((k) => (
                      <td key={k.key} className="px-2 py-1 tabular-nums">{row[k.key] === undefined ? "—" : chartNumber(row[k.key]!, 3)}</td>
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
