"use client";

import { ScrollText } from "lucide-react";
import { useShellStore } from "@/components/shell/shell-store";
import { QueryErrorBanner, Unavailable } from "@/components/service/app/overview/unavailable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n/t";
import type { ObsErrorsDto, ObsErrorsEntry } from "@/lib/observability/types";

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Asia/Tehran" });
const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) || d.getTime() === 0 ? "--:--:--" : clock.format(d);
};

function Entry({ entry }: { entry: ObsErrorsEntry }) {
  const openLogs = () => useShellStore.getState().openService(entry.id, "logs");
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-3" data-testid={`obs-errors-${entry.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          <bdi dir="ltr">{entry.name}</bdi>
        </h3>
        {!entry.unavailable && entry.count > 0 ? <Badge tone="danger">{t("observability.errors.count", { count: entry.count })}</Badge> : null}
        <Button variant="secondary" size="sm" onClick={openLogs} aria-label={t("observability.errors.openLogs", { name: entry.name })}>
          <ScrollText aria-hidden className="size-4" />
          {t("observability.errors.openLogsShort")}
        </Button>
      </div>
      {entry.unavailable ? (
        <Unavailable />
      ) : entry.lines.length === 0 ? (
        <p className="text-xs text-muted">{t("observability.errors.noneApp")}</p>
      ) : (
        <ul dir="ltr" className="flex flex-col gap-1" aria-label={t("observability.errors.lineLabel", { name: entry.name })}>
          {entry.lines.map((l, i) => (
            <li key={`${l.ts}-${i}`} className="rounded-md bg-code-bg px-2.5 py-1.5 font-mono text-xs leading-5 text-code-fg">
              <span className="me-2 text-muted">{timeOf(l.ts)}</span>
              {l.stream === "stderr" ? <span className="me-2 text-danger">{t("observability.errors.stderr")}</span> : null}
              <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{l.message}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Cross-service «آخرین خطاها»: redacted ERROR / stderr lines per app with a deep link to that app's logs tab. */
export function ErrorsPanel({
  data,
  error,
  pending,
  visibleIds,
  onRetry,
  retrying,
}: {
  data: ObsErrorsDto | undefined;
  error: unknown;
  pending: boolean;
  visibleIds: ReadonlySet<string>;
  onRetry: () => void;
  retrying: boolean;
}) {
  const entries = (data?.entries ?? []).filter((e) => visibleIds.has(e.id));
  // Apps with lines first, unreadable ones last.
  const rank = (e: ObsErrorsEntry) => (e.unavailable ? 2 : e.lines.length > 0 ? 0 : 1);
  const sorted = [...entries].sort((a, b) => rank(a) - rank(b));
  const anyLines = sorted.some((e) => !e.unavailable && e.lines.length > 0);
  return (
    <section aria-labelledby="obs-errors-title" data-testid="obs-errors-panel">
      <Card>
        <CardHeader>
          <CardTitle id="obs-errors-title">{t("observability.errors.title")}</CardTitle>
          <p className="text-sm leading-7 text-muted">{t("observability.errors.subtitle")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pending ? (
            <div aria-busy="true" className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !data ? (
            <ErrorBanner tone="warn" message={t("observability.errors.loadFailed")} onRetry={onRetry} retrying={retrying} />
          ) : (
            <>
              {error ? <QueryErrorBanner error={error} onRetry={onRetry} retrying={retrying} /> : null}
              {sorted.length > 0 && !anyLines && !sorted.some((e) => e.unavailable) ? <p className="text-sm text-muted">{t("observability.errors.none")}</p> : null}
              <ul className="flex flex-col gap-3">
                {sorted.map((e) => (
                  <Entry key={e.id} entry={e} />
                ))}
              </ul>
              <p className="text-xs leading-6 text-muted">{t("observability.errors.scanNote")}</p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

