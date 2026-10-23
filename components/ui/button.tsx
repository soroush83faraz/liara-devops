import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-lg border font-medium",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:pointer-events-none disabled:opacity-55",
  ],
  {
    variants: {
      variant: {
        primary: "border-transparent bg-accent text-accent-foreground hover:bg-accent/90",
        secondary: "border-border-strong/50 bg-surface text-foreground hover:bg-surface-muted",
        ghost: "border-transparent bg-transparent text-foreground hover:bg-surface-muted",
        danger: "border-transparent bg-danger text-danger-foreground hover:bg-danger/90",
      },
      size: {
        // >= 44px tall below md for touch, denser on pointer devices.
        sm: "min-h-11 px-3 text-sm md:min-h-9",
        md: "min-h-11 px-4 text-[15px] md:min-h-10",
        lg: "min-h-12 px-5 text-base",
      },
      fullWidth: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", fullWidth: false },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Shows a spinner and blocks clicks. */
  loading?: boolean;
  /** Replaces children while loading (otherwise children stay visible next to the spinner). */
  loadingText?: string;
}

export function Button({
  className,
  variant,
  size,
  fullWidth,
  loading = false,
  loadingText,
  disabled,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
