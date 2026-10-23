"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";
import { Tooltip } from "./tooltip";

const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center rounded-sm border transition-[background-color,border-color,color,transform] duration-150 active:scale-95",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        ghost: "border-transparent text-muted hover:bg-surface-muted hover:text-foreground",
        secondary: "border-border bg-surface text-foreground hover:border-border-strong/70 hover:bg-surface-muted",
        primary: "border-transparent bg-accent text-accent-foreground hover:bg-accent/88",
        danger: "border-transparent text-danger hover:bg-danger-soft",
      },
      size: {
        sm: "size-11 md:size-8",
        md: "size-11 md:size-10",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends Omit<ComponentProps<"button">, "aria-label" | "children">,
    VariantProps<typeof iconButtonVariants> {
  /** Required accessible name; also shown as a tooltip. */
  label: string;
  icon: ReactNode;
  loading?: boolean;
  tooltip?: boolean;
}

export function IconButton({
  label,
  icon,
  className,
  variant,
  size,
  loading = false,
  tooltip = true,
  disabled,
  type = "button",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Spinner /> : icon}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
