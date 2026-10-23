"use client";

import { CircleAlert, CircleCheck, HeartCrack, Layers, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { ErrorScanSummary, Summary } from "@/lib/observability/summary";
import { AnimatedNumber, Pulse } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

type Tone = "ok" | "danger" | "warn";

const iconTone: Record<Tone | "neutral", string> = {
  ok: "text-ok",
  danger: "text-danger",
  warn: "text-warn",
  neutral: "text-muted",
};

function Tile({
  label,
  value,
  hint,
  state,
  icon,
  tone,
  testId,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  state?: ReactNode;
  icon: ReactNode;
  tone?: Tone;
  testId: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex min-w-0 flex-col gap-1 bg-surface p-4", className)} data-testid={testId}>
      {tone === "danger" ? <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-danger/70" /> : null}
      <dt className="flex items-center gap-1.5 text-sm text-muted">
        <span aria-hidden className={cn("[&>svg]:size-4", iconTone[tone ?? "neutral"])}>
          {icon}
        </span>
        {label}
      </dt>
      <dd className="text-2xl font-bold leading-tight">{value}</dd>
      {state ? <dd className="min-h-5 text-xs leading-5">{state}</dd> : null}
      {hint ? <dd className="text-xs leading-5 text-muted">{hint}</dd> : null}
    </div>
  );
}

/** Change of a count since the previous refresh (a real, observed delta — never a guessed trend). */
function useDelta(value: number): number {
  const prev = useRef<number | null>(null);
  const [delta, setDelta] = useState(0);
  useEffect(() => {
    if (prev.current !== null && prev.current !== value) setDelta(value - prev.current);
    prev.current = value;
  }, [value]);
  return delta;
}

function Delta({ delta, upIsGood }: { delta: number; upIsGood: boolean }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const good = up === upIsGood;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", good ? "text-ok" : "text-danger")}>
      <Icon aria-hidden className="size-3.5" />
      {up ? t("observability.summary.deltaUp", { count: Math.abs(delta) }) : t("observability.summary.deltaDown", { count: Math.abs(delta) })}
    </span>
  );
}

function errorsTile(e: ErrorScanSummary): { value: string; hint: string; tone?: "warn" } {
  const heuristic = t("observability.summary.withErrorsHeuristic");
  if (e.kind === "unknown") return { value: t("observability.summary.errorsUnknown"), hint: `${t("observability.summary.errorsUnknownHint")} ${heuristic}` };
  const partial = e.scanned < e.total;
  return {
    value: partial ? t("observability.summary.atLeast", { count: e.withErrors }) : faNumber(e.withErrors),
    hint: `${partial ? t("observability.summary.scanPartial", { scanned: e.scanned, total: e.total }) : t("observability.summary.scanAll", { total: e.total })} ${heuristic}`,
    tone: e.withErrors > 0 ? "warn" : undefined,
  };
}

/** Total / healthy / unhealthy come from Liara status + our own probes. «دارای خطا» is a heuristic over log text, labelled as such. */
export function SummaryRow({ summary }: { summary: Summary }) {
  const totalDelta = useDelta(summary.total);
  const healthyDelta = useDelta(summary.healthy);
  const unhealthyDelta = useDelta(summary.unhealthy);
  const share = summary.total > 0 ? summary.healthy / summary.total : 0;
  const errors = errorsTile(summary.errors);

  return (
    <dl
      aria-label={t("observability.summary.label")}
      className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4"
    >
      <Tile
        testId="obs-summary-total"
        className="col-span-2 lg:col-span-1"
        label={t("observability.summary.total")}
        value={<AnimatedNumber value={summary.total} countUp />}
        state={<Delta delta={totalDelta} upIsGood />}
        icon={<Layers />}
      />
      <Tile
        testId="obs-summary-healthy"
        label={t("observability.summary.healthy")}
        value={<AnimatedNumber value={summary.healthy} countUp />}
        tone="ok"
        icon={<CircleCheck />}
        state={
          healthyDelta !== 0 ? (
            <Delta delta={healthyDelta} upIsGood />
          ) : (
            <span className="flex items-center gap-2 text-muted">
              <span aria-hidden className="relative h-1 w-16 overflow-hidden rounded-full bg-ok-soft">
                <span
                  className="absolute inset-0 origin-right rounded-full bg-ok transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ltr:origin-left"
                  style={{ transform: `scaleX(${share})` }}
                />
              </span>
              {t("observability.summary.healthyShare", { healthy: summary.healthy, total: summary.total })}
            </span>
          )
        }
      />
      <Tile
        testId="obs-summary-unhealthy"
        label={t("observability.summary.unhealthy")}
        value={<AnimatedNumber value={summary.unhealthy} countUp className={summary.unhealthy > 0 ? "text-danger" : undefined} />}
        tone={summary.unhealthy > 0 ? "danger" : undefined}
        icon={<HeartCrack />}
        state={
          unhealthyDelta !== 0 ? (
            <Delta delta={unhealthyDelta} upIsGood={false} />
          ) : summary.unhealthy > 0 ? (
            <span className="inline-flex items-center gap-2 font-medium text-danger">
              <Pulse tone="danger" />
              {t("observability.summary.needsAttention")}
            </span>
          ) : summary.total > 0 ? (
            <span className="text-muted">{t("observability.summary.allHealthy")}</span>
          ) : null
        }
      />
      <Tile testId="obs-summary-errors" label={t("observability.summary.withErrors")} value={errors.value} hint={errors.hint} tone={errors.tone} icon={<CircleAlert />} className="col-span-2 lg:col-span-1" />
    </dl>
  );
}
