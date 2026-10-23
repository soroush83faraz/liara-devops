"use client";

import { ErrorBanner, Skeleton } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { ApiError } from "@/lib/service/app-read/client";
import { describeError } from "../errors";

export function LoadError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  const d = describeError(error);
  const status = error instanceof ApiError && error.status ? `HTTP ${error.status}` : undefined;
  return <ErrorBanner title={t("errors.loadFailed")} message={d.message} detail={status} onRetry={onRetry} retrying={retrying} />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label={t("common.loading")} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
