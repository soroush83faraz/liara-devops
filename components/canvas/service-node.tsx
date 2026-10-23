"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Stethoscope } from "lucide-react";
import type { CSSProperties } from "react";
import { useShellStore } from "@/components/shell/shell-store";
import { isFailing, useHealthStore } from "@/lib/canvas/health-store";
import { NODE_HEIGHT, NODE_WIDTH, type HandleSide } from "@/lib/canvas/layout";
import type { OverviewService } from "@/lib/canvas/types";
import { relativeTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import { ProbeBadge } from "./probe-badge";
import { SignalTile, StatusWord, signalOf } from "./service-signal";

/** `index`: position in the entrance stagger (capped, see ENTRANCE_CAP). */
export type ServiceFlowNode = Node<{ service: OverviewService; index?: number }, "service">;

/** Red highlight: Liara says failed/unhealthy, or two probes in a row got no answer. */
export function needsAttention(service: OverviewService, failing: boolean): boolean {
  return service.status === "failed" || service.status === "unhealthy" || failing;
}

/** Only the first dozen cards stagger in (30 ms apart); the rest arrive with the twelfth. */
const ENTRANCE_CAP = 12;
const ENTRANCE_STEP_MS = 30;

/** «postgres · iran-g2-small»: the type and the plan, both LTR fragments (the kind word is visible or for AT only). */
export function ServiceMeta({ service, showKind = false }: { service: OverviewService; showKind?: boolean }) {
  return (
    <>
      <span className={showKind ? undefined : "sr-only"}>{service.kind === "db" ? t("canvasMap.database") : t("canvasMap.app")} </span>
      <bdi dir="ltr">{service.platformOrEngine}</bdi>
      {service.planId ? (
        <>
          <span aria-hidden className="px-1 text-border-strong">
            ·
          </span>
          <bdi dir="ltr">{service.planId}</bdi>
        </>
      ) : null}
    </>
  );
}

/**
 * Card body. `reserveAlertRow`: on the canvas the investigate action is a fixed-size button in the header row, so an
 * alert appearing never changes the card's height (the card's footprint is NODE_WIDTH x NODE_HEIGHT exactly).
 */
export function ServiceCardContent({ service, reserveAlertRow = false }: { service: OverviewService; reserveAlertRow?: boolean }) {
  const health = useHealthStore((s) => s.byService[service.id]);
  const failing = isFailing(health);
  const bad = needsAttention(service, failing);
  const signal = signalOf(service.status, failing);
  const when = service.lastDeployAt ?? service.createdAt;
  const whenText = when ? `${service.lastDeployAt ? t("canvasMap.lastDeploy") : t("canvasMap.created")} ${relativeTime(when)}` : undefined;
  return (
    <div className={cn("flex flex-col", reserveAlertRow && "h-full")}>
      <div className="flex items-start gap-3">
        <SignalTile kind={service.kind} platformOrEngine={service.platformOrEngine} signal={signal} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-label={t("canvasMap.openService", { name: service.name })}
            title={whenText}
            className="block max-w-full truncate rounded-[4px] text-start text-[15px] font-bold leading-6 tracking-[-0.005em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <bdi dir="ltr">{service.name}</bdi>
          </button>
          <p className="truncate text-xs leading-5 text-muted">
            <ServiceMeta service={service} />
          </p>
        </div>
        {bad ? (
          <button
            type="button"
            className={cn(
              "nodrag nopan -me-1 -mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-danger-soft text-danger-ink ring-1 ring-inset ring-danger/30 transition-colors duration-150 hover:bg-danger hover:text-danger-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            )}
            aria-label={t("canvasMap.investigateLabel", { name: service.name })}
            title={t("canvasMap.investigate")}
            onClick={(e) => {
              e.stopPropagation();
              useShellStore.getState().openService(service.id, "copilot");
            }}
          >
            <Stethoscope aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      <div className={cn("flex min-w-0 items-center justify-between gap-2", reserveAlertRow ? "mt-auto" : "mt-3")}>
        <StatusWord status={service.status} signal={signal} className="shrink-0" />
        <ProbeBadge health={health} kind={service.kind} compact />
      </div>
    </div>
  );
}

const SIDES: ReadonlyArray<[HandleSide, Position]> = [
  ["top", Position.Top],
  ["right", Position.Right],
  ["bottom", Position.Bottom],
  ["left", Position.Left],
];
/** Invisible, non-connectable anchors on every side: edges pick the side facing their other end (edgeSides). */
const HANDLE_CLASS = "!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent";

export function ServiceNode({ data, selected }: NodeProps<ServiceFlowNode>) {
  const { service } = data;
  const failing = useHealthStore((s) => isFailing(s.byService[service.id]));
  const bad = needsAttention(service, failing);
  const delay = Math.min(data.index ?? 0, ENTRANCE_CAP - 1) * ENTRANCE_STEP_MS;
  return (
    // Fixed footprint (layout.ts NODE_HEIGHT): alerts never grow the card into a neighbour. The handles sit on this
    // static layer, so the entrance and hover transforms below never shift where edges attach.
    <div dir="rtl" style={{ width: NODE_WIDTH, height: NODE_HEIGHT }} className="relative">
      {SIDES.map(([side, pos]) => (
        <Handle key={`t-${side}`} id={`t-${side}`} type="target" position={pos} isConnectable={false} className={HANDLE_CLASS} />
      ))}
      {/* One-shot entrance; its fill-mode pins `transform`, so the hover lift lives on the card inside it. */}
      <div className="hl-enter absolute inset-0" style={{ animationDelay: `${delay}ms` } as CSSProperties}>
        <div
          data-selected={selected || undefined}
          className={cn(
            "size-full cursor-pointer overflow-hidden rounded-md border bg-surface p-3 text-foreground",
            "shadow-[var(--shadow-soft)] transition-[transform,box-shadow,border-color] duration-200 ease-out-expo hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]",
            bad
              ? "border-danger/70 shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_45%,transparent),0_10px_32px_-10px_color-mix(in_oklab,var(--danger)_45%,transparent)] hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_45%,transparent),0_14px_36px_-10px_color-mix(in_oklab,var(--danger)_55%,transparent)]"
              : selected
                ? "border-accent shadow-[var(--glow-accent)] hover:shadow-[var(--glow-accent)]"
                : "border-border hover:border-border-strong/60",
          )}
        >
          <ServiceCardContent service={service} reserveAlertRow />
        </div>
      </div>
      {SIDES.map(([side, pos]) => (
        <Handle key={`s-${side}`} id={`s-${side}`} type="source" position={pos} isConnectable={false} className={HANDLE_CLASS} />
      ))}
    </div>
  );
}
