import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Pressable filter chip (aria-pressed) with a >=44px touch target on small screens. */
export function ToggleChip({ pressed, className, ...props }: ComponentProps<"button"> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors md:min-h-8",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        pressed
          ? "border-accent bg-accent-soft font-medium text-accent-ink"
          : "border-border-strong/50 bg-surface text-foreground hover:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}
