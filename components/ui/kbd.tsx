import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        "inline-flex min-w-6 items-center justify-center rounded-md border border-border-strong/50 bg-surface-muted px-1.5 font-mono text-xs leading-6 text-foreground",
        className,
      )}
      {...props}
    />
  );
}
