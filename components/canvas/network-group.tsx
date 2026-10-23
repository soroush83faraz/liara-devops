"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { Network } from "lucide-react";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";

export type NetworkFlowNode = Node<{ name: string | null; count: number; width: number; height: number }, "network">;

/**
 * Frame for one private network ("project"): a dashed hairline with its name in a small chip sitting on the top
 * border, like a fieldset legend. Purely visual: not draggable, not focusable.
 */
export function NetworkGroup({ data }: NodeProps<NetworkFlowNode>) {
  return (
    <div
      dir="rtl"
      style={{ width: data.width, height: data.height }}
      className="hl-enter relative rounded-lg border border-dashed border-border-strong/45 bg-[color-mix(in_oklab,var(--surface)_28%,transparent)]"
    >
      <div className="absolute -top-3 start-4 flex h-6 max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-xs font-medium text-muted shadow-[var(--shadow-soft)]">
        <Network aria-hidden className="size-3.5 shrink-0 text-accent" />
        {data.name === null ? (
          <span className="truncate">{t("canvasMap.noNetwork")}</span>
        ) : (
          <span className="min-w-0 truncate">
            {t("canvasMap.networkFrame")} <bdi dir="ltr" className="font-semibold text-foreground">{data.name}</bdi>
          </span>
        )}
        <span aria-hidden className="ms-0.5 rounded-full bg-surface-muted px-1.5 text-[11px] leading-4 tabular-nums">
          {faNumber(data.count)}
        </span>
      </div>
    </div>
  );
}
