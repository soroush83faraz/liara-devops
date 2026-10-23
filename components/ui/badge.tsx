import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 [&>svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "bg-surface-muted text-muted ring-1 ring-inset ring-border",
        accent: "bg-accent-soft text-accent-ink ring-1 ring-inset ring-accent/20",
        ok: "bg-ok-soft text-ok-ink ring-1 ring-inset ring-ok/20",
        warn: "bg-warn-soft text-warn-ink ring-1 ring-inset ring-warn/20",
        danger: "bg-danger-soft text-danger-ink ring-1 ring-inset ring-danger/20",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

/** Pass an icon as the first child for semantic tones: colour alone must never carry meaning. */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
