"use client";

import { CircleCheck, CircleSlash, ScrollText, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useShellStore } from "@/components/shell/shell-store";
import { QueryErrorBanner, Unavailable } from "@/components/service/app/overview/unavailable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n/t";
import type { ObsErrorsDto, ObsErrorsEntry } from "@/lib/observability/types";
import { fadeUp, stagger } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Asia/Tehran" });
const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) || d.getTime() === 0 ? "--:--:--" : clock.format(d);
};

type Severity = "errors" | "clean" | "unknown";
const severityOf = (e: ObsErrorsEntry): Severity => (e.unavailable ? "unknown" : e.lines.length > 0 || e.count > 0 ? "errors" : "clean");

function SeverityChip({ entry }: { entry: ObsErrorsEntry }) {
  if (entry.unavailable) return null; // <Unavailable> below already says it, with its own icon.
  if (severityOf(entry) === "clean")
    return (
      <Badge tone="ok">
        <CircleCheck aria-hidden />
        {t("observability.errors.noneApp")}
      </Badge>
    );
  return entry.count > 0 ? (
    <Badge tone="danger">
      <TriangleAlert aria-hidden />
      {t("observability.errors.count", { count: entry.count })}
    </Badge>
  ) : null;
}

function Entry({ entry }: { entry: ObsErrorsEntry }) {
  const openLogs = () => useShellStore.getState().openService(entry.id, "logs");
  const sev = severityOf(entry);
  return (
    <motion.li
      variants={fadeUp}
      className={cn("flex flex-col gap-2.5 rounded-md border bg-surface p-3", sev === "errors" ? "border-danger/35" : "border-border")}
      data-testid={`obs-errors-${entry.name}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-sm [&>svg]:size-4",
            sev === "errors" ? "bg-danger-soft text-danger-ink" : sev === "clean" ? "bg-ok-soft text-ok-ink" : "bg-surface-muted text-muted",
          )}
        >
          {sev === "errors" ? <TriangleAlert /> : sev === "clean" ? <CircleCheck /> : <CircleSlash />}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          <bdi dir="ltr">{entry.name}</bdi>
        </h3>
        <SeverityChip entry={entry} />
        <Button variant="ghost" size="sm" onClick={openLogs} aria-label={t("observability.errors.openLogs", { name: entry.name })}>
          <ScrollText aria-hidden className="size-4" />
          {t("observability.errors.openLogsShort")}
        </Button>
      </div>
      {entry.unavailable ? (
        <Unavailable />
      ) : entry.lines.length === 0 ? null : (
        <ul
          dir="ltr"
          className="flex flex-col overflow-hidden rounded-sm border border-border bg-code-bg"
          aria-label={t("observability.errors.lineLabel", { name: entry.name })}
        >
          {entry.lines.map((l, i) => (
            <li key={`${l.ts}-${i}`} className="flex gap-3 border-t border-border/70 px-3 py-1.5 font-mono text-xs leading-5 text-code-fg first:border-t-0">
              <time className="shrink-0 text-muted">{timeOf(l.ts)}</time>
              <span className="min-w-0 flex-1">
                {l.stream === "stderr" ? (
                  <span className="me-2 inline-flex rounded-[4px] bg-danger-soft px-1.5 text-[11px] font-semibold text-danger-ink">{t("observability.errors.stderr")}</span>
                ) : null}
                <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{l.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </motion.li>
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
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <header className="flex flex-col gap-0.5">
          <h2 id="obs-errors-title" className="text-lg font-bold">
            {t("observability.errors.title")}
          </h2>
          <p className="text-sm text-muted">{t("observability.errors.subtitle")}</p>
        </header>
        {pending ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-14 w-full rounded-md" />
          </div>
        ) : !data ? (
          <ErrorBanner tone="warn" message={t("observability.errors.loadFailed")} onRetry={onRetry} retrying={retrying} />
        ) : (
          <>
            {error ? <QueryErrorBanner error={error} onRetry={onRetry} retrying={retrying} /> : null}
            {sorted.length > 0 && !anyLines && !sorted.some((e) => e.unavailable) ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted">
                <CircleCheck aria-hidden className="size-4 text-ok" />
                {t("observability.errors.none")}
              </p>
            ) : null}
            <motion.ul initial="hidden" animate="show" variants={stagger(0.05)} className="flex flex-col gap-2.5">
              {sorted.map((e) => (
                <Entry key={e.id} entry={e} />
              ))}
            </motion.ul>
            <p className="text-xs leading-6 text-muted">{t("observability.errors.scanNote")}</p>
          </>
        )}
      </Card>
    </section>
  );
}
