"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, Clock, FileSearch, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { fa } from "@/lib/i18n/fa";
import { faDateTime, relativeTime } from "@/lib/i18n/format";
import { listIncidents, type IncidentListItem } from "@/lib/copilot/api";
import { outcomeOf, OUTCOME_TONE } from "@/lib/copilot/incident-view";
import { EvidenceLevelChip } from "../evidence-level-chip";
import { MockDataBadge } from "../mock-data-badge";

const l = fa.copilotUi.incidentsPage;

const OUTCOME_LABEL = {
  none: l.outcomeNone,
  pending: l.outcomePending,
  verified: l.outcomeVerified,
  not_verified: l.outcomeNotVerified,
  failed: l.outcomeFailed,
} as const;
const OUTCOME_ICON = { none: Clock, pending: Clock, verified: CircleCheck, not_verified: TriangleAlert, failed: CircleX } as const;

function Row({ item }: { item: IncidentListItem }) {
  const outcome = outcomeOf(item);
  const Icon = OUTCOME_ICON[outcome];
  const resolved = Boolean(item.resolvedAt);
  return (
    <li>
      <Link
        href={`/incidents/${encodeURIComponent(item.id)}`}
        aria-label={`${l.open}: ${item.target.name}`}
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted">{l.target}</span>
          <span className="flex items-center gap-2">
            <bdi dir="ltr" className="truncate font-mono text-sm font-semibold">
              {item.target.name}
            </bdi>
            <Badge tone={resolved ? "ok" : "warn"}>{resolved ? l.statusResolved : l.statusOpen}</Badge>
            <MockDataBadge />
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{l.started}</span>
          <time dateTime={item.startedAt} className="text-sm" title={faDateTime(item.startedAt)}>
            {relativeTime(item.startedAt)}
          </time>
        </div>
        <div className="flex flex-col items-start gap-1">
          <span className="text-xs text-muted">{l.outcome}</span>
          <Badge tone={OUTCOME_TONE[outcome]} className="gap-1.5">
            <Icon aria-hidden className="size-3.5" />
            {OUTCOME_LABEL[outcome]}
          </Badge>
        </div>
        <div className="flex flex-col items-start gap-1">
          <span className="text-xs text-muted">{l.evidence}</span>
          {item.level ? <EvidenceLevelChip level={item.level} /> : <span className="text-sm text-muted">{fa.common.dash}</span>}
        </div>
      </Link>
    </li>
  );
}

export function IncidentsList() {
  const q = useQuery({ queryKey: ["incidents"], queryFn: ({ signal }) => listIncidents(undefined, signal) });
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold leading-10">{fa.incidents.title}</h1>
        <p className="text-sm leading-7 text-muted">{l.subtitle}</p>
      </header>
      {q.isPending ? (
        <div aria-busy className="flex flex-col gap-3">
          <p className="sr-only">{fa.common.loading}</p>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorBanner title={l.loadFailed} message={fa.errors.neverFabricated} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={<FileSearch />} title={fa.incidents.empty} description={l.emptyHint} />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
