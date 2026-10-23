"use client";

import { createElement } from "react";
import type { ServiceStatus, StatusTone } from "@/components/ui/status";
import { statusMeta } from "@/components/ui/status";
import type { ServiceKind } from "@/lib/canvas/types";
import { t } from "@/lib/i18n/t";
import { Pulse } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { serviceIcon } from "./service-icon";

/**
 * The one visual signal a service gives off on the canvas, the list and the panel header:
 * live (running/healthy, accent pulse) · idle (stopped, hollow grey) · alert (failed/unhealthy/not answering,
 * danger glow) · busy (building) · warn (degraded) · unknown. Always paired with the status word.
 */
export type Signal = "live" | "idle" | "alert" | "busy" | "warn" | "unknown";

export function signalOf(status: ServiceStatus, failing = false): Signal {
  if (failing || status === "failed" || status === "unhealthy") return "alert";
  if (status === "running" || status === "healthy") return "live";
  if (status === "stopped") return "idle";
  if (status === "building") return "busy";
  if (status === "degraded") return "warn";
  return "unknown";
}

const PULSE: Record<Signal, { tone: "accent" | "ok" | "warn" | "danger" | "muted"; active: boolean; hollow?: boolean }> = {
  live: { tone: "accent", active: true },
  idle: { tone: "muted", active: false, hollow: true },
  alert: { tone: "danger", active: true },
  busy: { tone: "warn", active: true },
  warn: { tone: "warn", active: false },
  unknown: { tone: "muted", active: false },
};

/** Ring drawn around the icon tile, by signal. */
const RING: Record<Signal, string> = {
  live: "ring-accent/45",
  idle: "ring-border-strong/35",
  alert: "ring-danger/70 shadow-[0_0_0_4px_color-mix(in_oklab,var(--danger)_14%,transparent),0_0_18px_color-mix(in_oklab,var(--danger)_35%,transparent)]",
  busy: "ring-warn/55",
  warn: "ring-warn/55",
  unknown: "ring-border-strong/35",
};

/** Text colour of the status word, from Liara's own status (a failing probe colours the dot, not this word). */
const WORD: Record<StatusTone, string> = {
  ok: "text-foreground",
  info: "text-foreground",
  neutral: "text-muted",
  warn: "text-warn",
  danger: "text-danger",
};

/** Minimap / list tint per signal (CSS colours). */
export const SIGNAL_COLOR: Record<Signal, string> = {
  live: "var(--accent)",
  idle: "var(--border-strong)",
  alert: "var(--danger)",
  busy: "var(--warn)",
  warn: "var(--warn)",
  unknown: "var(--border-strong)",
};

export function SignalPulse({ signal, className }: { signal: Signal; className?: string }) {
  const p = PULSE[signal];
  return <Pulse tone={p.tone} active={p.active} hollow={p.hollow} className={className} />;
}

/** Service type icon in a neutral tile, ringed in its status colour, with the live dot on its corner. Decorative. */
export function SignalTile({
  kind,
  platformOrEngine,
  signal,
  size = "md",
  className,
}: {
  kind: ServiceKind;
  platformOrEngine: string;
  signal: Signal;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-sm border border-border bg-surface-muted text-foreground/85 ring-[1.5px] ring-offset-2 ring-offset-surface transition-shadow duration-300",
        size === "lg" ? "size-10" : "size-9",
        RING[signal],
        className,
      )}
    >
      {createElement(serviceIcon(kind, platformOrEngine), { className: size === "lg" ? "size-5" : "size-[18px]", strokeWidth: 1.75 })}
      <span className="absolute -end-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-surface">
        <SignalPulse signal={signal} />
      </span>
    </span>
  );
}

/** Status as a word next to a small dot (the word carries the meaning; the dot is the glanceable signal). */
export function StatusWord({ status, signal, className }: { status: ServiceStatus; signal: Signal; className?: string }) {
  const meta = statusMeta(status);
  return (
    <span
      data-status={status}
      className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs font-medium leading-5", WORD[meta.tone], className)}
    >
      <SignalPulse signal={signal} className="size-1.5" />
      <span className="truncate">{t(meta.labelKey)}</span>
    </span>
  );
}
