import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Block of LTR monospace text (logs, stack traces, JSON). Aligned to the line start of its own direction. */
export function Code({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      dir="ltr"
      className={cn(
        "overflow-x-auto rounded-lg border border-border bg-code-bg p-4 text-start font-mono text-[13px] leading-6 text-code-fg",
        className,
      )}
      {...props}
    />
  );
}

/** Inline LTR fragment (URL, IP, env key, status code, path) isolated from the surrounding RTL text. */
export function Ltr({ className, ...props }: ComponentProps<"bdi">) {
  return (
    <bdi
      dir="ltr"
      className={cn("rounded bg-code-bg px-1.5 py-0.5 font-mono text-[0.875em]", className)}
      {...props}
    />
  );
}
