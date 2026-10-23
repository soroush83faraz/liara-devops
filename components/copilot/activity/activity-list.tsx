"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, Cog, ShieldOff, Sparkles, User, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuditEntry, AuditResult } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { faDateTime, relativeTime } from "@/lib/i18n/format";
import { AUDIT_DEFAULT_LIMIT, listAudit } from "@/lib/copilot/api";
import { auditActionLabel, distinctActions, filterAudit, isFiltering, isRedactedName, NO_FILTERS, type AuditFilters } from "@/lib/copilot/audit-view";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import { fadeUp, stagger } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { EmptyLedgerArt } from "../empty-art";

const a = fa.activity;

const RESULT_META: Record<AuditResult, { tone: "ok" | "danger" | "warn"; icon: LucideIcon }> = {
  ok: { tone: "ok", icon: CircleCheck },
  error: { tone: "danger", icon: CircleX },
  denied: { tone: "warn", icon: ShieldOff },
};

function ResultBadge({ result }: { result: AuditResult }) {
  const meta = RESULT_META[result];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} className="gap-1.5">
      <Icon aria-hidden className="size-3.5" />
      {a.result[result]}
    </Badge>
  );
}

const ACTOR_ICON: Record<AuditEntry["actor"], LucideIcon> = { user: User, "agent-approved-by-user": Sparkles, system: Cog };

function Entry({ e }: { e: AuditEntry }) {
  const action = auditActionLabel(e.action);
  const redacted = isRedactedName(e.target.name);
  const ActorIcon = ACTOR_ICON[e.actor] ?? Cog;
  return (
    <motion.li
      variants={fadeUp}
      className="grid gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-muted/50 sm:grid-cols-[9.5rem_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
        <time dateTime={e.ts} title={e.ts} className="text-sm font-medium">
          {faDateTime(e.ts)}
        </time>
        <span className="text-xs text-muted">{relativeTime(e.ts)}</span>
      </div>
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border",
            e.actor === "agent-approved-by-user" ? "border-accent/30 bg-accent-soft text-accent-ink" : "border-border bg-surface-muted text-muted",
          )}
        >
          <ActorIcon className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-semibold">
            {action.known ? (
              action.label
            ) : (
              <bdi dir="ltr" className="font-mono text-[0.9em]">
                {action.label}
              </bdi>
            )}
          </span>
          <span className="text-xs text-muted">{a.actor[e.actor]}</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted">{a.targetKind[e.target.kind]}</span>
        {redacted ? (
          <span className="truncate text-sm text-muted">{a.redacted}</span>
        ) : (
          <bdi dir="ltr" className="truncate text-start font-mono text-sm">
            {e.target.name}
          </bdi>
        )}
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <ResultBadge result={e.result} />
      </div>
      {e.detail || e.proposalId ? (
        <div className="flex flex-col gap-1 rounded-sm bg-surface-muted/50 px-3 py-2 text-xs leading-6 text-muted sm:col-span-3 sm:col-start-2">
          {e.detail ? <span dir="auto">{stripUnsafeChars(e.detail)}</span> : null}
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {e.proposalId ? (
              <span>
                {a.proposal}:{" "}
                <bdi dir="ltr" className="font-mono text-foreground/80">
                  {e.proposalId}
                </bdi>
              </span>
            ) : null}
            <span>
              {a.paramsHash}:{" "}
              <bdi dir="ltr" className="font-mono text-foreground/80" title={e.paramsHash}>
                {e.paramsHash.slice(0, 12)}
              </bdi>
            </span>
          </span>
        </div>
      ) : null}
    </motion.li>
  );
}

function EmptyBlock({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-6 py-12 text-center">
      <EmptyLedgerArt />
      <h2 className="mt-1 text-base font-bold">{title}</h2>
      <p className="max-w-md text-sm leading-7 text-muted">{body}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ActivityList() {
  const q = useQuery({ queryKey: ["audit", AUDIT_DEFAULT_LIMIT], queryFn: ({ signal }) => listAudit(AUDIT_DEFAULT_LIMIT, undefined, signal) });
  const [filters, setFilters] = useState<AuditFilters>(NO_FILTERS);
  const entries = q.data;

  const actionOptions = useMemo(
    () => [{ value: "all", label: a.all }, ...distinctActions(entries ?? []).map((value) => ({ value, label: auditActionLabel(value).label }))],
    [entries],
  );
  const resultOptions = useMemo(
    () => [{ value: "all", label: a.all }, ...(["ok", "error", "denied"] as const).map((value) => ({ value, label: a.result[value] }))],
    [],
  );
  const shown = useMemo(() => filterAudit(entries ?? [], filters), [entries, filters]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{a.title}</h1>
        <p className="text-sm text-muted">{a.subtitle}</p>
      </header>

      {q.isPending ? (
        <div aria-busy className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          <p className="sr-only">{fa.common.loading}</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <div className="flex w-36 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="size-7" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <ErrorBanner title={a.loadFailed} message={fa.errors.neverFabricated} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : entries && entries.length === 0 ? (
        <EmptyBlock title={a.emptyTitle} body={a.emptyBody} />
      ) : (
        <>
          <section aria-label={a.filters} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <span id="flt-action" className="text-sm font-medium">
                {a.filterAction}
              </span>
              <Select
                aria-label={a.filterAction}
                options={actionOptions}
                value={filters.action}
                onValueChange={(action) => setFilters((f) => ({ ...f, action }))}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <span id="flt-result" className="text-sm font-medium">
                {a.filterResult}
              </span>
              <Select
                aria-label={a.filterResult}
                options={resultOptions}
                value={filters.result}
                onValueChange={(result) => setFilters((f) => ({ ...f, result: result as AuditFilters["result"] }))}
              />
            </div>
            {isFiltering(filters) ? (
              <Button variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
                {a.clearFilters}
              </Button>
            ) : null}
          </section>

          <p role="status" aria-live="polite" className="text-sm text-muted">
            {fill(a.count, { shown: shown.length, total: entries?.length ?? 0 })}
          </p>

          {shown.length === 0 ? (
            <EmptyBlock
              title={a.noMatchTitle}
              body={a.noMatchBody}
              action={
                <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
                  {a.clearFilters}
                </Button>
              }
            />
          ) : (
            <motion.ul
              key={`${filters.action}-${filters.result}`}
              initial="hidden"
              animate="show"
              variants={stagger(0.035)}
              className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border bg-surface"
            >
              {shown.map((e, i) => (
                <Entry key={`${e.ts}-${e.action}-${i}`} e={e} />
              ))}
            </motion.ul>
          )}
          <p className="text-xs leading-6 text-muted">
            {a.redactedNote} {fill(a.limitNote, { limit: AUDIT_DEFAULT_LIMIT })}
          </p>
        </>
      )}
    </div>
  );
}
