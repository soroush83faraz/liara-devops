import { CircleSlash } from "lucide-react";
import { ErrorBanner } from "@/components/ui";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";
import { ApiError } from "@/lib/service/app-read/client";

/** Honest «data unavailable» marker: never a fabricated value. */
export function Unavailable({ hint, className }: { hint?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 text-sm text-muted", className)}>
      <span className="inline-flex items-center gap-1.5">
        <CircleSlash aria-hidden className="size-4 shrink-0" />
        {t("appOps.common.unavailable")}
      </span>
      {hint ? <span className="text-xs leading-6">{t("appOps.common.unavailableHint")}</span> : null}
    </div>
  );
}

/** Query failure with retry. 4xx server messages are already safe, Persian text. */
export function QueryErrorBanner({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const api = error instanceof ApiError ? error : null;
  const message = !api ? t("errors.generic") : api.status === 0 ? t("errors.network") : api.message;
  return (
    <ErrorBanner
      title={t("appOps.common.loadFailed")}
      message={message}
      detail={api && api.status ? `HTTP ${api.status}` : undefined}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}
