"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { Network } from "lucide-react";
import { t } from "@/lib/i18n/t";

export type NetworkFlowNode = Node<{ name: string | null; count: number; width: number; height: number }, "network">;

/** Frame for one private network ("project"). Purely visual: not draggable, not focusable. */
export function NetworkGroup({ data }: NodeProps<NetworkFlowNode>) {
  return (
    <div
      dir="rtl"
      style={{ width: data.width, height: data.height }}
      className="rounded-2xl border border-dashed border-border-strong/60 bg-surface-muted/50"
    >
      <div className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-muted">
        <Network aria-hidden className="size-4" />
        {data.name === null ? (
          <span>{t("canvasMap.noNetwork")}</span>
        ) : (
          <span className="min-w-0 truncate">
            {t("canvasMap.networkFrame")} <bdi dir="ltr">{data.name}</bdi>
          </span>
        )}
      </div>
    </div>
  );
}
