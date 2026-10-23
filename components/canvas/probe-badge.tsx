"use client";

import { Activity, CircleDashed, CircleHelp, CircleX, History, TriangleAlert, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { FAILURES_BEFORE_ALERT, type ServiceHealth } from "@/lib/canvas/health-store";
import { faNumber, relativeTime } from "@/lib/i18n/format";
import { t, type TKey } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "ok" | "warn" | "danger";

interface ProbeView {
  tone: Tone;
  icon: LucideIcon;
  /** Full sentence: the regular badge's text, the compact chip's tooltip and accessible text. */
  label: string;
  /** Short words for the compact chip (and the chip part of a split badge). Defaults to `label`. */
  short?: string;
  /** The rest of `label` once `short` is said («نام دامنه هنوز پیدا نمی‌شود»): a split badge shows it beside the chip. */
  detail?: string;
  /** Secondary context (when it was checked) for the tooltip. */
  title?: string;
  probe?: "unprobeable" | "stale";
}

function probeView(health: ServiceHealth | undefined, kind: "app" | "db"): ProbeView {
  if (kind === "db") return { tone: "neutral", icon: CircleHelp, label: t("canvasMap.probe.none"), title: t("canvasMap.probe.unsupported") };
  if (!health || health.status === "unknown") return { tone: "neutral", icon: CircleHelp, label: t("canvasMap.probe.checking") };
  const when = health.checkedAt ? t("canvasMap.probe.checkedAt", { time: relativeTime(health.checkedAt) }) : undefined;
  const reason = health.error ? t(`canvasMap.probe.errors.${health.error}` as TKey) : undefined;
  if (health.status === "unprobeable") {
    // Not a failure: the site cannot be checked (no public address, refused address, name never resolved).
    const why = reason ?? t("canvasMap.probe.errors.unknown");
    return {
      tone: "neutral",
      icon: CircleDashed,
      label: t("canvasMap.probe.unprobeable", { reason: why }),
      short: t("canvasMap.probe.short.unprobeable"),
      detail: why,
      title: when,
      probe: "unprobeable",
    };
  }
  if (health.stale) {
    // An old result is never shown as a fresh green: amber and labelled «قدیمی»; its age is in the full badge's text.
    const age = health.checkedAt ? relativeTime(health.checkedAt) : t("canvasMap.probe.ageUnknown");
    return {
      tone: "warn",
      icon: History,
      label: t("canvasMap.probe.stale", { time: age }),
      short: t("canvasMap.probe.short.stale"),
      detail: t("canvasMap.probe.staleDetail", { time: age }),
      title: when,
      probe: "stale",
    };
  }
  if (health.status === "ok") {
    const ms = faNumber(health.latencyMs ?? 0);
    return {
      tone: "ok",
      icon: Activity,
      label: t("canvasMap.probe.ok", { status: health.httpStatus ?? 200, ms }),
      short: t("canvasMap.probe.latency", { ms }),
      title: when,
    };
  }
  if (health.status === "degraded") {
    const status = health.httpStatus ?? 400;
    return {
      tone: "warn",
      icon: TriangleAlert,
      label: t("canvasMap.probe.clientError", { status }),
      short: t("canvasMap.probe.short.clientError", { status }),
      title: when,
    };
  }
  const label =
    health.consecutiveFailures >= FAILURES_BEFORE_ALERT
      ? t("canvasMap.probe.down", { count: health.consecutiveFailures })
      : t("canvasMap.probe.downOnce");
  return { tone: "danger", icon: CircleX, label, short: t("canvasMap.probe.short.down"), title: [reason, when].filter(Boolean).join(" · ") };
}

const CHIP_TONE: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted ring-border",
  ok: "bg-ok-soft text-ok-ink ring-ok/25",
  warn: "bg-warn-soft text-warn-ink ring-warn/25",
  danger: "bg-danger-soft text-danger-ink ring-danger/30",
};

/**
 * Live probe result: icon + text, never colour alone. `undefined` health = not probed yet.
 * - `compact` (canvas cards): a one-line chip with a few words (latency when healthy, «قابل بررسی نیست», «قدیمی»…);
 *   the full sentence is its tooltip and its accessible text. Databases render nothing (no HTTP check).
 * - default (list rows, monitoring cards): the chip, then the reason beside it as plain muted text when there is one,
 *   so a long reason wraps as prose instead of stretching a pill over two lines.
 */
export function ProbeBadge({ health, kind, compact = false, className }: { health?: ServiceHealth; kind: "app" | "db"; compact?: boolean; className?: string }) {
  const v = probeView(health, kind);
  if (compact) {
    if (kind === "db") return null;
    const tip = (
      <>
        {v.label}
        {v.title ? <span className="block font-normal opacity-75">{v.title}</span> : null}
      </>
    );
    return (
      <Tooltip content={tip}>
        <span
          data-probe={v.probe}
          className={cn(
            "inline-flex h-5 min-w-0 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium ring-1 ring-inset",
            CHIP_TONE[v.tone],
            className,
          )}
        >
          {createElement(v.icon, { "aria-hidden": true, className: "size-3 shrink-0" })}
          <span aria-hidden className="truncate leading-5">
            {v.short ?? v.label}
          </span>
          <span className="sr-only">{v.label}</span>
        </span>
      </Tooltip>
    );
  }
  if (v.detail && v.short) {
    return (
      <span data-probe={v.probe} title={v.title} className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5", className)}>
        <Badge tone={v.tone} className="shrink-0">
          {createElement(v.icon, { "aria-hidden": true, className: "size-3.5" })}
          {v.short}
          <span className="sr-only">:</span>
        </Badge>
        <span className="min-w-0 text-xs leading-5 text-muted">{v.detail}</span>
      </span>
    );
  }
  return (
    <Badge tone={v.tone} title={v.title} data-probe={v.probe} className={className}>
      {createElement(v.icon, { "aria-hidden": true, className: "size-3.5" })}
      {v.label}
    </Badge>
  );
}
