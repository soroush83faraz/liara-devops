"use client";

import { CircleSlash } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, ErrorBanner } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { ApiError } from "@/lib/service/db/client";
import { cn } from "@/lib/utils";

export interface DbPanelProps {
  /** Database hostname (panel `name`). */
  name: string;
}

export function SectionCard({ title, icon, description, children }: { title: string; icon?: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon ? <span aria-hidden className="text-muted [&>svg]:size-4">{icon}</span> : null}
          {title}
        </CardTitle>
        {description ? <p className="text-sm leading-7 text-muted">{description}</p> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Honest «data unavailable» marker: never a fabricated value. */
export function Unavailable({ hint, className }: { hint?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 text-sm text-muted", className)}>
      <span className="inline-flex items-center gap-1.5">
        <CircleSlash aria-hidden className="size-4 shrink-0" />
        {t("dbPanel.common.unavailable")}
      </span>
      {hint ? <span className="text-xs leading-6">{t("dbPanel.common.unavailableHint")}</span> : null}
    </div>
  );
}

/** Safe, Persian message of a failed request (server messages are already safe; network/unknown get generic text). */
export function errorMessage(error: unknown): string {
  const api = error instanceof ApiError ? error : null;
  if (!api) return t("errors.generic");
  if (api.status === 0) return t("errors.network");
  return api.message && api.message !== String(api.status) ? api.message : t("errors.generic");
}

export function QueryError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <ErrorBanner
      title={t("dbPanel.common.loadFailed")}
      message={errorMessage(error)}
      detail={api && api.status ? `HTTP ${api.status}` : undefined}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}

/** LTR monospace block for connection strings and the like (wraps, selectable). */
export function CodeLine({ children, label }: { children: string; label: string }) {
  return (
    <bdi dir="ltr" aria-label={label} className="block max-w-full select-all break-all rounded-sm bg-code-bg px-3 py-2 text-start font-mono text-[13px] leading-6">
      {children}
    </bdi>
  );
}
