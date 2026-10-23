"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Info, ScrollText, TriangleAlert } from "lucide-react";
import { Badge, EmptyState, Skeleton } from "@/components/ui";
import { faDateTime, relativeTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { EventDto, LogLevel } from "@/lib/service/app-read/types";
import { dbKeys, dbPath, fetchJson } from "@/lib/service/db/client";
import { QueryError, SectionCard, type DbPanelProps } from "./shared";

interface EventsResponse {
  sinceSec: number;
  events: EventDto[];
}

const TONE: Record<LogLevel, "danger" | "warn" | "neutral"> = { error: "danger", warn: "warn", info: "neutral", debug: "neutral", unknown: "neutral" };
const ICON = { error: CircleAlert, warn: TriangleAlert, info: Info, debug: Info, unknown: Info } as const;

export function DbEventsTab({ name }: DbPanelProps) {
  const q = useQuery({
    queryKey: dbKeys.events(name),
    queryFn: ({ signal }) => fetchJson<EventsResponse>(dbPath(name, "events"), signal),
    refetchInterval: 30_000,
  });

  return (
    <SectionCard title={t("dbPanel.events.title")} icon={<ScrollText />} description={t("dbPanel.events.window")}>
      {q.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.data.events.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={t("dbPanel.events.empty")} />
      ) : (
        <>
          <ul className="divide-y divide-border" aria-live="polite">
            {q.data.events.map((e, i) => {
              const Icon = ICON[e.level];
              return (
                <li key={`${e.ts}-${i}`} className="flex flex-col gap-1 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[e.level]}>
                      <Icon aria-hidden className="size-3.5" />
                      {t(`dbPanel.events.levels.${e.level}`)}
                    </Badge>
                    <time dateTime={e.ts} title={faDateTime(e.ts)} className="text-xs text-muted">
                      {relativeTime(e.ts)}
                    </time>
                  </div>
                  <bdi dir="ltr" className="break-words font-mono text-[13px] leading-6">{e.message}</bdi>
                </li>
              );
            })}
          </ul>
          {q.data.events.length >= 200 ? <p className="mt-2 text-xs text-muted">{t("dbPanel.events.capped")}</p> : null}
        </>
      )}
    </SectionCard>
  );
}
