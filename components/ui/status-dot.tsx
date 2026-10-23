import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";
import { statusMeta, type ServiceStatus, type StatusTone } from "./status";

const toneText = cva("", {
  variants: {
    tone: {
      ok: "text-ok",
      warn: "text-warn",
      danger: "text-danger",
      info: "text-accent",
      neutral: "text-muted",
    } satisfies Record<StatusTone, string>,
  },
});

/**
 * Status = icon + label + colour (never colour alone).
 * `compact` hides the visible label but keeps it for assistive tech and as a tooltip title.
 */
export function StatusDot({
  status,
  compact = false,
  className,
}: {
  status: ServiceStatus;
  compact?: boolean;
  className?: string;
}) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  const label = t(meta.labelKey);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-sm font-medium", className)}
      title={compact ? label : undefined}
      data-status={status}
    >
      <Icon aria-hidden className={cn("size-4 shrink-0", toneText({ tone: meta.tone }), meta.busy && "animate-pulse")} />
      <span className={cn(compact && "sr-only")}>{label}</span>
    </span>
  );
}
