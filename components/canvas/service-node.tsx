"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Stethoscope } from "lucide-react";
import { useShellStore } from "@/components/shell/shell-store";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { isFailing, useHealthStore } from "@/lib/canvas/health-store";
import { NODE_HEIGHT, NODE_WIDTH, type HandleSide } from "@/lib/canvas/layout";
import type { OverviewService } from "@/lib/canvas/types";
import { relativeTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import { ProbeBadge } from "./probe-badge";
import { ServiceIcon } from "./service-icon";

export type ServiceFlowNode = Node<{ service: OverviewService }, "service">;

/** Red highlight: Liara says failed/unhealthy, or two probes in a row got no answer. */
export function needsAttention(service: OverviewService, failing: boolean): boolean {
  return service.status === "failed" || service.status === "unhealthy" || failing;
}

/** `reserveAlertRow`: on the canvas the CTA row always takes its space, so the card's height never changes. */
export function ServiceCardContent({ service, reserveAlertRow = false }: { service: OverviewService; reserveAlertRow?: boolean }) {
  const health = useHealthStore((s) => s.byService[service.id]);
  const bad = needsAttention(service, isFailing(health));
  const when = service.lastDeployAt ?? service.createdAt;
  return (
    <div className={cn("flex flex-col gap-2", reserveAlertRow && "h-full")}>
      <div className="flex items-start gap-2.5">
        <ServiceIcon kind={service.kind} platformOrEngine={service.platformOrEngine} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-label={t("canvasMap.openService", { name: service.name })}
            className="block max-w-full truncate rounded text-start text-[15px] font-semibold leading-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <bdi dir="ltr">{service.name}</bdi>
          </button>
          <p className="truncate text-xs leading-5 text-muted">
            {service.kind === "db" ? t("canvasMap.database") : t("canvasMap.app")} · <bdi dir="ltr">{service.platformOrEngine}</bdi>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusDot status={service.status} />
        <ProbeBadge health={health} kind={service.kind} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs leading-5 text-muted">
        {service.planId ? (
          <>
            <dt>{t("canvasMap.plan")}</dt>
            <dd className="truncate">
              <bdi dir="ltr">{service.planId}</bdi>
            </dd>
          </>
        ) : null}
        {when ? (
          <>
            <dt>{service.lastDeployAt ? t("canvasMap.lastDeploy") : t("canvasMap.created")}</dt>
            <dd className="truncate">{relativeTime(when)}</dd>
          </>
        ) : null}
        {service.kind === "app" ? (
          <>
            <dt className="sr-only">URL</dt>
            <dd className="col-span-2 truncate">
              {service.url ? <bdi dir="ltr">{service.url.replace(/^https?:\/\//, "")}</bdi> : t("canvasMap.noUrl")}
            </dd>
          </>
        ) : null}
      </dl>
      {bad ? (
        <Button
          variant="danger"
          size="sm"
          className={cn("nodrag nopan min-h-9 w-full", reserveAlertRow ? "mt-auto" : "mt-1")}
          aria-label={t("canvasMap.investigateLabel", { name: service.name })}
          onClick={(e) => {
            e.stopPropagation();
            useShellStore.getState().openService(service.id, "copilot");
          }}
        >
          <Stethoscope aria-hidden className="size-4" />
          {t("canvasMap.investigate")}
        </Button>
      ) : reserveAlertRow ? (
        <div aria-hidden className="mt-auto min-h-9" />
      ) : null}
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

export function ServiceNode({ data }: NodeProps<ServiceFlowNode>) {
  const { service } = data;
  const failing = useHealthStore((s) => isFailing(s.byService[service.id]));
  const bad = needsAttention(service, failing);
  return (
    <div
      dir="rtl"
      // Fixed footprint (layout.ts NODE_HEIGHT): alerts never grow the card into a neighbour.
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        "cursor-pointer overflow-hidden rounded-xl border bg-surface p-3 text-foreground shadow-sm transition-shadow hover:shadow-md",
        bad ? "border-danger ring-2 ring-danger/40" : "border-border",
      )}
    >
      {SIDES.map(([side, pos]) => (
        <Handle key={`t-${side}`} id={`t-${side}`} type="target" position={pos} isConnectable={false} className={HANDLE_CLASS} />
      ))}
      <ServiceCardContent service={service} reserveAlertRow />
      {SIDES.map(([side, pos]) => (
        <Handle key={`s-${side}`} id={`s-${side}`} type="source" position={pos} isConnectable={false} className={HANDLE_CLASS} />
      ))}
    </div>
  );
}
