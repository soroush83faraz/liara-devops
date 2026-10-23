"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { t } from "@/lib/i18n/t";

export type EnvFlowEdge = Edge<{ viaKey: string }, "env">;

/**
 * Derived env -> database link. The label carries the variable KEY only (never a value). Orthogonal routing from the
 * card sides that face each other (see edgeSides), so the line runs through the gaps between cards, not over text.
 * The label is a solid pill (surface background, foreground text: >= 4.5:1 in light and dark).
 */
export const EDGE_LABEL_CLASS =
  "pointer-events-none absolute max-w-48 truncate rounded-full border border-border-strong bg-surface px-2 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-sm";

export function EnvEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<EnvFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12, offset: 18 });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: "var(--accent)", strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <div
          dir="ltr"
          title={t("canvasMap.edge.via", { key: data?.viaKey ?? "" })}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, zIndex: 5 }}
          className={EDGE_LABEL_CLASS}
        >
          {data?.viaKey}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
