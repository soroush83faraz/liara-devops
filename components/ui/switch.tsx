"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DIR } from "./dir";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}

/**
 * Labelled switch. The control itself is a 44 x 44 px hit area (the 44 x 24 track is drawn inside it), and it is
 * named by the visible label through aria-labelledby (so the name can never be missing or out of date).
 */
export function Switch({ label, description, className, ...root }: SwitchProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descId = `${id}-desc`;
  return (
    <div className={cn("flex min-h-11 items-center justify-between gap-4", className)}>
      <label htmlFor={id} className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center">
        <span id={labelId} className="text-[15px] font-medium">
          {label}
        </span>
        {description ? (
          <span id={descId} className="text-xs leading-6 text-muted">
            {description}
          </span>
        ) : null}
      </label>
      <SwitchPrimitive.Root
        id={id}
        dir={DIR}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        {...root}
        className={cn(
          "group inline-flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-lg",
          "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent",
          "disabled:cursor-not-allowed disabled:opacity-55",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex h-6 w-11 items-center rounded-full border border-transparent p-0.5 transition-colors",
            "bg-border-strong group-data-[state=checked]:bg-accent",
          )}
        >
          <SwitchPrimitive.Thumb
            className={cn(
              "block size-5 rounded-full bg-white shadow-sm transition-transform",
              "data-[state=checked]:translate-x-5 rtl:data-[state=checked]:-translate-x-5",
            )}
          />
        </span>
      </SwitchPrimitive.Root>
    </div>
  );
}
