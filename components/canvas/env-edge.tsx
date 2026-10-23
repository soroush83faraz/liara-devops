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
  "pointer-events-none absolute max-w-44 truncate rounded-full border border-border bg-surface px-2 py-px font-mono text-[10.5px] font-medium leading-4 text-foreground shadow-[var(--shadow-soft)]";

/**
 * A faint solid rail plus a 1.5 px dashed line whose dashes flow from the app towards the database (the direction the
 * connection string points). The flow is a CSS stroke-dashoffset loop: paint-only, and still under reduced motion.
 */
export function EnvEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<EnvFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12, offset: 18 });
  return (
    <>
      <path d={path} fill="none" stroke="var(--accent)" strokeOpacity={0.18} strokeWidth={3} />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: "var(--accent)", strokeWidth: 1.5, strokeDasharray: "5 3", animation: "hl-dash 1.4s linear infinite" }}
      />
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
