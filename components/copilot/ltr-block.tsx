import type { ReactNode } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

/**
 * LTR monospace block for logs, stack traces, requests. Content is a React text child (never HTML).
 * `copy` adds a copy button that copies exactly the shown text.
 */
export function LtrBlock({
  text,
  copy = false,
  className,
  maxHeightClass = "max-h-56",
  label,
  extra,
}: {
  text: string;
  copy?: boolean;
  className?: string;
  maxHeightClass?: string;
  label?: string;
  extra?: ReactNode;
}) {
  return (
    <div dir="ltr" className={cn("relative", className)}>
      <pre
        dir="ltr"
        tabIndex={0}
        aria-label={label}
        className={cn(
          "overflow-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-code-bg p-3 text-start font-mono text-[13px] leading-6 text-code-fg",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          maxHeightClass,
          copy && "pe-12",
        )}
      >
        {text}
      </pre>
      {copy ? (
        <div className="absolute end-1 top-1">
          <CopyButton value={text} size="sm" />
        </div>
      ) : null}
      {extra}
    </div>
  );
}
