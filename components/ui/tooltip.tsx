"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DIR } from "./dir";

/** Wraps a single focusable child. Content is supplementary: never put required information only in a tooltip. */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "start" | "end";
  className?: string;
}) {
  // Radix sides are physical; map the logical start/end for RTL.
  const physical = side === "start" ? "right" : side === "end" ? "left" : side;
  return (
    <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            dir={DIR}
            side={physical}
            sideOffset={6}
            className={cn(
              "z-50 max-w-xs origin-(--radix-tooltip-content-transform-origin) rounded-sm bg-foreground px-2.5 py-1 text-xs font-medium leading-5 text-background shadow-[var(--shadow-soft)] animate-hl-pop",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
