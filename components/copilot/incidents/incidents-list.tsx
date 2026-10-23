"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, CircleCheck, CircleX, Clock, ShieldCheck, Siren, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { fa } from "@/lib/i18n/fa";
import { faDateTime, relativeTime } from "@/lib/i18n/format";
import { listIncidents, type IncidentListItem } from "@/lib/copilot/api";
import { outcomeOf, OUTCOME_TONE } from "@/lib/copilot/incident-view";
import { EvidenceLevelChip } from "../evidence-level-chip";
import { MockDataBadge } from "../mock-data-badge";
import { QuietSignalArt } from "../empty-art";
import { fadeUp, stagger } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

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
    <motion.li variants={fadeUp}>
      <Link
        href={`/incidents/${encodeURIComponent(item.id)}`}
        aria-label={`${l.open}: ${item.target.name}`}
        className="group grid gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:items-center"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm",
              resolved ? "bg-ok-soft text-ok-ink" : "bg-warn-soft text-warn-ink",
            )}
          >
            {resolved ? <ShieldCheck className="size-4" /> : <Siren className="size-4" />}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <bdi dir="ltr" className="truncate text-start font-mono text-sm font-semibold">
              {item.target.name}
            </bdi>
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={resolved ? "ok" : "warn"}>{resolved ? l.statusResolved : l.statusOpen}</Badge>
              <MockDataBadge />
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
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
        <ChevronLeft aria-hidden className="hidden size-4 text-muted transition-transform duration-200 group-hover:-translate-x-0.5 sm:block ltr:-scale-x-100" />
      </Link>
    </motion.li>
  );
}

export function IncidentsList() {
  const q = useQuery({ queryKey: ["incidents"], queryFn: ({ signal }) => listIncidents(undefined, signal) });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{fa.incidents.title}</h1>
        <p className="text-sm text-muted">{l.subtitle}</p>
      </header>
      {q.isPending ? (
        <div aria-busy className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          <p className="sr-only">{fa.common.loading}</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="size-8" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <ErrorBanner title={l.loadFailed} message={fa.errors.neverFabricated} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.data.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-6 py-12 text-center">
          <QuietSignalArt />
          <h2 className="mt-1 text-base font-bold">{fa.incidents.empty}</h2>
          <p className="max-w-md text-sm leading-7 text-muted">{l.emptyHint}</p>
        </div>
      ) : (
        <motion.ul initial="hidden" animate="show" variants={stagger(0.05)} className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {q.data.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </motion.ul>
      )}
    </div>
  );
}
