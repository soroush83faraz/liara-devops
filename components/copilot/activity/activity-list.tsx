"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, History, ShieldOff, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuditEntry, AuditResult } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { faDateTime, relativeTime } from "@/lib/i18n/format";
import { AUDIT_DEFAULT_LIMIT, listAudit } from "@/lib/copilot/api";
import { auditActionLabel, distinctActions, filterAudit, isFiltering, isRedactedName, NO_FILTERS, type AuditFilters } from "@/lib/copilot/audit-view";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";

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

function Entry({ e }: { e: AuditEntry }) {
  const action = auditActionLabel(e.action);
  const redacted = isRedactedName(e.target.name);
  return (
    <li className="grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] sm:items-center">
      <div className="flex flex-col gap-0.5">
        <time dateTime={e.ts} title={e.ts} className="text-sm font-medium">
          {faDateTime(e.ts)}
        </time>
        <span className="text-xs text-muted">{relativeTime(e.ts)}</span>
      </div>
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted">
          {a.targetKind[e.target.kind]}
        </span>
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
        <div className="flex flex-col gap-1 text-xs leading-6 text-muted sm:col-span-4">
          {e.detail ? <span dir="auto">{stripUnsafeChars(e.detail)}</span> : null}
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {e.proposalId ? (
              <span>
                {a.proposal}:{" "}
                <bdi dir="ltr" className="font-mono">
                  {e.proposalId}
                </bdi>
              </span>
            ) : null}
            <span>
              {a.paramsHash}:{" "}
              <bdi dir="ltr" className="font-mono" title={e.paramsHash}>
                {e.paramsHash.slice(0, 12)}
              </bdi>
            </span>
          </span>
        </div>
      ) : null}
    </li>
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
      <header>
        <h1 className="text-2xl font-bold leading-10">{a.title}</h1>
        <p className="text-sm leading-7 text-muted">{a.subtitle}</p>
      </header>

      {q.isPending ? (
        <div aria-busy className="flex flex-col gap-3">
          <p className="sr-only">{fa.common.loading}</p>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorBanner title={a.loadFailed} message={fa.errors.neverFabricated} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : entries && entries.length === 0 ? (
        <EmptyState icon={<History />} title={a.emptyTitle} description={a.emptyBody} />
      ) : (
        <>
          <section aria-label={a.filters} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-end">
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
            <EmptyState
              icon={<History />}
              title={a.noMatchTitle}
              description={a.noMatchBody}
              action={
                <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
                  {a.clearFilters}
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((e, i) => (
                <Entry key={`${e.ts}-${e.action}-${i}`} e={e} />
              ))}
            </ul>
          )}
          <p className="text-xs leading-6 text-muted">
            {a.redactedNote} {fill(a.limitNote, { limit: AUDIT_DEFAULT_LIMIT })}
          </p>
        </>
      )}
    </div>
  );
}
