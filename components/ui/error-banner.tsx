import { CircleAlert, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";
import { Button } from "./button";

/** Inline error (icon + text) with an optional retry. Never shows fabricated data in place of the failure. */
export function ErrorBanner({
  title,
  message,
  detail,
  onRetry,
  retrying,
  retryLabel,
  tone = "danger",
  className,
}: {
  title?: ReactNode;
  message: ReactNode;
  /** Technical detail (request id, status code), rendered LTR. */
  detail?: string;
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  tone?: "danger" | "warn";
  className?: string;
}) {
  const Icon = tone === "danger" ? CircleAlert : TriangleAlert;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start",
        tone === "danger" ? "border-danger/40 bg-danger-soft text-danger-ink" : "border-warn/40 bg-warn-soft text-warn-ink",
        className,
      )}
    >
      <Icon aria-hidden className="mt-1 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold leading-8">{title}</p> : null}
        <p className="text-sm leading-7">{message}</p>
        {detail ? (
          <bdi dir="ltr" className="mt-1 block break-words font-mono text-xs opacity-90">
            {detail}
          </bdi>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying} className="shrink-0 self-start">
          {retrying ? null : <RefreshCw aria-hidden className="size-4" />}
          {retryLabel ?? t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}
