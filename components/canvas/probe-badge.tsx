"use client";

import { Activity, CircleDashed, CircleHelp, CircleX, History, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FAILURES_BEFORE_ALERT, type ServiceHealth } from "@/lib/canvas/health-store";
import { faNumber, relativeTime } from "@/lib/i18n/format";
import { t, type TKey } from "@/lib/i18n/t";

/** Live probe result as a badge: icon + text, never colour alone. `undefined` = not probed yet. */
export function ProbeBadge({ health, kind }: { health?: ServiceHealth; kind: "app" | "db" }) {
  if (kind === "db") {
    return (
      <Badge tone="neutral" title={t("canvasMap.probe.unsupported")}>
        <CircleHelp aria-hidden className="size-3.5" />
        {t("canvasMap.probe.none")}
      </Badge>
    );
  }
  if (!health || health.status === "unknown") {
    return (
      <Badge tone="neutral">
        <CircleHelp aria-hidden className="size-3.5" />
        {t("canvasMap.probe.checking")}
      </Badge>
    );
  }
  const when = health.checkedAt ? t("canvasMap.probe.checkedAt", { time: relativeTime(health.checkedAt) }) : undefined;
  const reason = health.error ? t(`canvasMap.probe.errors.${health.error}` as TKey) : undefined;
  if (health.status === "unprobeable") {
    // Not a failure: the site cannot be checked (no public address, refused address, name never resolved).
    return (
      <Badge tone="neutral" title={when} data-probe="unprobeable" className="max-w-full whitespace-normal text-start leading-5">
        <CircleDashed aria-hidden className="size-3.5 shrink-0" />
        {t("canvasMap.probe.unprobeable", { reason: reason ?? t("canvasMap.probe.errors.unknown") })}
      </Badge>
    );
  }
  if (health.stale) {
    // An old result is never shown as a fresh green: amber, labelled, with its age in the visible text.
    const age = health.checkedAt ? relativeTime(health.checkedAt) : t("canvasMap.probe.ageUnknown");
    return (
      <Badge tone="warn" title={when} data-probe="stale" className="max-w-full whitespace-normal text-start leading-5">
        <History aria-hidden className="size-3.5 shrink-0" />
        {t("canvasMap.probe.stale", { time: age })}
      </Badge>
    );
  }
  if (health.status === "ok") {
    return (
      <Badge tone="ok" title={when}>
        <Activity aria-hidden className="size-3.5" />
        {t("canvasMap.probe.ok", { status: health.httpStatus ?? 200, ms: faNumber(health.latencyMs ?? 0) })}
      </Badge>
    );
  }
  if (health.status === "degraded") {
    return (
      <Badge tone="warn" title={when}>
        <TriangleAlert aria-hidden className="size-3.5" />
        {t("canvasMap.probe.clientError", { status: health.httpStatus ?? 400 })}
      </Badge>
    );
  }
  const label =
    health.consecutiveFailures >= FAILURES_BEFORE_ALERT
      ? t("canvasMap.probe.down", { count: health.consecutiveFailures })
      : t("canvasMap.probe.downOnce");
  return (
    <Badge tone="danger" title={[reason, when].filter(Boolean).join(" · ")}>
      <CircleX aria-hidden className="size-3.5" />
      {label}
    </Badge>
  );
}
