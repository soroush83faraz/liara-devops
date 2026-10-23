import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-6",
  {
    variants: {
      tone: {
        neutral: "bg-surface-muted text-muted ring-1 ring-inset ring-border",
        accent: "bg-accent-soft text-accent-ink",
        ok: "bg-ok-soft text-ok-ink",
        warn: "bg-warn-soft text-warn-ink",
        danger: "bg-danger-soft text-danger-ink",
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
