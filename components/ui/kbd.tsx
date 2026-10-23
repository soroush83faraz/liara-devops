import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border bg-surface px-1 font-mono text-[11px] leading-none text-muted shadow-[0_1px_0_var(--border)]",
        className,
      )}
      {...props}
    />
  );
}
