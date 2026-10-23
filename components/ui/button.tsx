import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-sm border font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-accent text-accent-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:bg-accent/88 hover:shadow-[var(--glow-accent)]",
        secondary: "border-border bg-surface text-foreground hover:border-border-strong/70 hover:bg-surface-muted",
        ghost: "border-transparent bg-transparent text-foreground hover:bg-surface-muted",
        danger: "border-transparent bg-danger text-danger-foreground hover:bg-danger/88",
      },
      size: {
        // >= 44px tall below md for touch, denser on pointer devices.
        sm: "min-h-11 px-3 text-sm md:min-h-8",
        md: "min-h-11 px-4 text-[15px] md:min-h-10",
        lg: "min-h-12 px-5 text-base",
      },
      fullWidth: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", fullWidth: false },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Shows a spinner and a progress sweep, and blocks clicks. */
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
      className={cn(buttonVariants({ variant, size, fullWidth }), loading && "overflow-hidden disabled:opacity-80", className)}
      {...props}
    >
      {loading ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          {/* Physical `left: 0` on purpose: the sweep keyframes are physical translateX (reversed in RTL). */}
          <span style={{ left: 0 }} className="absolute inset-y-0 w-1/2 animate-hl-sweep bg-linear-to-r from-transparent via-current/20 to-transparent rtl:[animation-direction:reverse]" />
        </span>
      ) : null}
      {loading ? <Spinner /> : null}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
