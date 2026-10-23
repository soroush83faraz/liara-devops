"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartMarker } from "@/lib/observability/markers";
import { t } from "@/lib/i18n/t";
import { chartMax, chartNumber, chartTime, chartTimeSec, niceTicks, seriesDash } from "@/lib/ui/chart-axis";

/*
 * The dashboard's own area chart (always LTR, text alternative via `ariaLabel`, data table offered by the caller).
 * Marks follow the dataviz spec: 2 px lines, a ~10 % wash for a single series, recessive solid hairline grid, no axis
 * lines, a crosshair + tooltip on hover, and deployment markers as dashed verticals with a small time chip.
 * Every number on it (ticks, tooltip, marker chips) uses Persian digits; the y axis climbs in even, round steps.
 */


export interface ObsChartKey {
  key: string;
  label: string;
  color: string;
}

interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
  keys,
  stacked,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  unit: string;
  keys: readonly ObsChartKey[];
  stacked: boolean;
}) {
  if (!active || !payload?.length) return null;
  const colorOf = new Map(keys.map((k) => [k.key, k.color]));
  // Stacked areas list top-down in the same order the bands are drawn (last key on top).
  const rows = (stacked ? [...payload].reverse() : payload).filter((p) => p.value !== undefined && p.value !== null);
  const total = rows.reduce((sum, p) => sum + Number(p.value ?? 0), 0);
  return (
    <div className="min-w-40 rounded-sm border border-border bg-surface px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
      <p className="mb-1.5 text-[11px] tabular-nums text-muted">{chartTimeSec(Number(label))}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: colorOf.get(String(p.dataKey)) ?? p.color }} />
            <span className="min-w-0 flex-1 truncate text-foreground/85">{p.name}</span>
            <span className="font-medium tabular-nums text-foreground">{chartNumber(Number(p.value), 3)}</span>
          </li>
        ))}
      </ul>
      {stacked && rows.length > 1 ? (
        <p className="mt-1.5 flex items-center gap-2 border-t border-border pt-1.5">
          <span className="flex-1 text-muted" dir="rtl">
            {t("observability.chart.total")}
          </span>
          <span className="font-semibold tabular-nums">{chartNumber(total, 3)}</span>
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-muted" dir="rtl">
        {unit}
      </p>
    </div>
  );
}

/** Small time chip on top of a deployment marker. The <text> holds exactly the marker label (e.g. «۱۴:۳۰»). */
function MarkerChip({ viewBox, value }: { viewBox?: { x?: number; y?: number }; value: string }) {
  const x = viewBox?.x ?? 0;
  const y = (viewBox?.y ?? 0) - 15;
  const w = 38;
  return (
    <g pointerEvents="none">
      <rect x={x - w / 2} y={y} width={w} height={14} rx={7} fill="var(--surface-muted)" stroke="var(--border)" />
      <text x={x} y={y + 10.5} textAnchor="middle" fontSize={10} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </text>
    </g>
  );
}

export function ObsAreaChart({
  rows,
  keys,
  unit,
  ariaLabel,
  height = 200,
  markers,
  stacked = false,
  compact = false,
}: {
  rows: Array<Record<string, number>>;
  keys: ObsChartKey[];
  unit: string;
  ariaLabel: string;
  height?: number;
  markers?: readonly ChartMarker[];
  stacked?: boolean;
  compact?: boolean;
}) {
  const tick = { fontSize: compact ? 10 : 11, fill: "var(--muted)" };
  const labelled = (markers ?? []).some((mk) => mk.showLabel);
  const single = keys.length === 1 && !stacked;
  const lastIndex = rows.length - 1;
  const y = niceTicks(chartMax(rows, keys.map((k) => k.key), stacked), compact ? 2 : 4);

  return (
    <>
      <div dir="ltr" role="img" aria-label={ariaLabel} style={{ height }} className="animate-hl-fade [&_.recharts-surface]:overflow-visible [&_*:focus]:outline-none">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={rows} margin={{ top: labelled ? 22 : 8, right: 6, bottom: 0, left: 0 }}>
            <defs>
              {keys.map((k) => (
                <linearGradient key={k.key} id={`obs-wash-${k.key}-${compact ? "c" : "f"}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={k.color} stopOpacity={stacked ? 0.34 : 0.2} />
                  <stop offset="100%" stopColor={k.color} stopOpacity={stacked ? 0.18 : 0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={chartTime}
              tick={tick}
              tickLine={false}
              axisLine={{ stroke: "var(--border-strong)", strokeOpacity: 0.5 }}
              minTickGap={compact ? 44 : 36}
              tickMargin={6}
            />
            <YAxis
              width={compact ? 36 : 46}
              tick={tick}
              tickLine={false}
              axisLine={false}
              ticks={y.ticks}
              interval={0}
              tickFormatter={(v: number) => chartNumber(v)}
              domain={[0, y.top]}
              allowDataOverflow
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  payload={props.payload as readonly TooltipEntry[] | undefined}
                  label={props.label as number | undefined}
                  unit={unit}
                  keys={keys}
                  stacked={stacked}
                />
              )}
            />
            {(markers ?? []).map((mk) => (
              <ReferenceLine
                key={`${mk.id}-${mk.t}`}
                x={mk.t}
                stroke="var(--muted)"
                strokeOpacity={0.8}
                strokeDasharray="4 3"
                strokeWidth={1}
                label={mk.showLabel ? (props: { viewBox?: { x?: number; y?: number } }) => <MarkerChip viewBox={props.viewBox} value={mk.label} /> : undefined}
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
                fill={`url(#obs-wash-${k.key}-${compact ? "c" : "f"})`}
                strokeWidth={stacked ? 1.5 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={
                  single
                    ? (p: { index?: number; cx?: number; cy?: number; value?: unknown }) =>
                        p.index === lastIndex && p.cx !== undefined && p.cy !== undefined && p.value != null ? (
                          <circle key="end" cx={p.cx} cy={p.cy} r={3.5} fill={k.color} stroke="var(--surface)" strokeWidth={2} />
                        ) : (
                          <g key={`d${p.index}`} />
                        )
                    : false
                }
                activeDot={{ r: 4, fill: k.color, stroke: "var(--surface)", strokeWidth: 2 }}
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

/**
 * Legend for two or more series: a short line key beside each name (identity is never colour alone). `stacked` must
 * match the chart's, so an overlaid series' key is dashed like its line.
 */
export function ObsLegend({ keys, label, className, stacked = false }: { keys: readonly ObsChartKey[]; label?: string; className?: string; stacked?: boolean }) {
  return (
    <ul aria-label={label} className={className ?? "flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"}>
      {keys.map((k, i) => (
        <li key={k.key} className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="14" height="4" className="shrink-0 overflow-visible">
            <line x1="1" y1="2" x2="13" y2="2" stroke={k.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={seriesDash(i, stacked) ? "3.5 3" : undefined} />
          </svg>
          <span className="text-foreground/85">{k.label}</span>
        </li>
      ))}
    </ul>
  );
}
