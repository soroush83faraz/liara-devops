"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { KeyValueList } from "@/components/ui/key-value-list";
import { Skeleton } from "@/components/ui/skeleton";
import type { Incident, Proposal } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { faDateTime } from "@/lib/i18n/format";
import { ApiFailure } from "@/lib/copilot/stream-client";
import { getIncident, getIncidentMarkdown, getProposal } from "@/lib/copilot/api";
import { copyToClipboard } from "@/lib/copilot/clipboard";
import { durationMinutes } from "@/lib/copilot/incident-view";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import { verificationHeadline } from "@/lib/copilot/verification";
import { EvidenceItem } from "../evidence-item";
import { EvidenceLevelChip } from "../evidence-level-chip";
import { MockDataBadge } from "../mock-data-badge";
import { SafeMarkdown } from "../safe-markdown";
import { VerificationBody } from "../verification-card";

const l = fa.copilotUi.incidentsPage;

// Print: drop the app chrome and let the report flow over several pages.
const PRINT_CSS = `@media print {
  header.sticky { display: none !important; }
  .h-dvh { height: auto !important; }
  #main-content { overflow: visible !important; }
  aside { display: none !important; }
  [data-print-hide] { display: none !important; }
  body { background: #fff !important; }
  [data-print-card] { break-inside: avoid; border-color: #999 !important; }
}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-print-card className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="text-lg font-semibold leading-8">{title}</h2>
      {children}
    </section>
  );
}

function approvalTime(incident: Incident, proposal?: Proposal): string | undefined {
  const fromHistory = proposal?.history?.find((h) => h.status === "approved")?.at;
  if (fromHistory) return fromHistory;
  return incident.timeline.find((t) => t.kind === "approved")?.ts;
}

function Report({ incident, proposal, proposalFailed }: { incident: Incident; proposal?: Proposal; proposalFailed: boolean }) {
  const main = incident.finding.hypotheses[0];
  const headline = verificationHeadline(incident.verification);
  const minutes = durationMinutes(incident.startedAt, incident.resolvedAt);
  const cited = main ? incident.finding.facts.filter((o) => main.supports.includes(o.id) || main.contradicts.includes(o.id)) : [];
  const approvedAt = approvalTime(incident, proposal);
  const outcomeLabel =
    headline.kind === "verified"
      ? l.outcomeVerified
      : headline.kind === "not_verified"
        ? l.outcomeNotVerified
        : headline.kind === "failed"
          ? l.outcomeFailed
          : incident.proposalId
            ? l.outcomePending
            : l.outcomeNone;
  const outcomeTone = headline.kind === "verified" ? "ok" : headline.kind === "not_verified" ? "warn" : headline.kind === "failed" ? "danger" : "neutral";

  return (
    <div className="flex flex-col gap-4">
      <Section title={l.header}>
        <MockDataBadge className="self-start" />
        <KeyValueList
          items={[
            {
              key: l.target,
              value: (
                <>
                  {fa.activity.targetKind[incident.target.kind]}{" "}
                  <bdi dir="ltr" className="font-mono text-[0.9em]">
                    {incident.target.name}
                  </bdi>
                </>
              ),
            },
            { key: l.status, value: <Badge tone={incident.resolvedAt ? "ok" : "warn"}>{incident.resolvedAt ? l.statusResolved : l.statusOpen}</Badge> },
            { key: l.started, value: faDateTime(incident.startedAt) },
            { key: l.resolvedAt, value: incident.resolvedAt ? faDateTime(incident.resolvedAt) : l.ongoing },
            ...(minutes !== null ? [{ key: l.duration, value: fill(l.durationMinutes, { n: minutes }) }] : []),
            { key: l.outcome, value: <Badge tone={outcomeTone}>{outcomeLabel}</Badge> },
            ...(main ? [{ key: l.evidence, value: <EvidenceLevelChip level={main.level} reason={main.levelReason} /> }] : []),
          ]}
        />
        {incident.summaryMarkdown ? <SafeMarkdown text={incident.summaryMarkdown} className="rounded-lg bg-surface-muted p-3" /> : null}
      </Section>

      {incident.timeline.length > 0 ? (
        <Section title={l.timeline}>
          <ol className="flex flex-col gap-2 border-s-2 border-border ps-4">
            {incident.timeline.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 text-sm leading-7">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge>{l.timelineKind[e.kind]}</Badge>
                  <time dateTime={e.ts} className="text-xs text-muted">
                    {faDateTime(e.ts)}
                  </time>
                </span>
                {e.textFa ? <span>{stripUnsafeChars(e.textFa)}</span> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section title={l.rootCause}>
        {main ? (
          <div className="flex flex-col gap-2">
            <EvidenceLevelChip level={main.level} reason={main.levelReason} />
            <p className="text-base font-semibold leading-8">{stripUnsafeChars(main.titleFa)}</p>
            <SafeMarkdown text={main.explanationFa} className="text-muted" />
          </div>
        ) : (
          <p className="text-sm text-muted">{fa.copilotUi.finding.noHypotheses}</p>
        )}
        {incident.finding.hypotheses.length > 1 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {incident.finding.hypotheses.slice(1).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <EvidenceLevelChip level={h.level} />
                <span>{stripUnsafeChars(h.titleFa)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {cited.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{l.citedObservations}</h3>
            {cited.map((o) => (
              <EvidenceItem key={o.id} observation={o} />
            ))}
          </div>
        ) : null}
        {incident.finding.unknowns.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{fa.copilotUi.finding.unknown}</h3>
            <ul className="ms-5 list-disc text-sm leading-7">
              {incident.finding.unknowns.map((u, i) => (
                <li key={i}>{stripUnsafeChars(u.descriptionFa)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title={l.actionTaken}>
        {incident.proposalId ? (
          proposal ? (
            <KeyValueList
              items={[
                { key: fa.copilotUi.proposal.title, value: fa.copilotUi.actions[proposal.type] },
                { key: l.actionStatus, value: fa.copilotUi.proposal.status[proposal.status] },
                { key: l.proposedAt, value: faDateTime(proposal.createdAt) },
                { key: l.approvedAt, value: approvedAt ? faDateTime(approvedAt) : fa.common.dash },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">{proposalFailed ? fa.errors.loadFailed : fa.common.loading}</p>
          )
        ) : (
          <p className="text-sm text-muted">{l.noAction}</p>
        )}
        {proposal ? <SafeMarkdown text={proposal.effectFa} className="text-muted" /> : null}
      </Section>

      <Section title={l.verificationResult}>
        {incident.verification ? <VerificationBody result={incident.verification} /> : <p className="text-sm text-muted">{l.noVerification}</p>}
      </Section>

      {incident.finding.limitsNote && incident.finding.limitsNote.length > 0 ? (
        <Section title={l.limits}>
          <ul className="ms-5 list-disc text-sm leading-7">
            {incident.finding.limitsNote.map((n, i) => (
              <li key={i}>{stripUnsafeChars(n)}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="hidden text-xs text-muted print:block">{l.printFooter}</p>
    </div>
  );
}

export function IncidentReport({ id }: { id: string }) {
  const incidentQ = useQuery({ queryKey: ["incident", id], queryFn: ({ signal }) => getIncident(id, undefined, signal) });
  const proposalId = incidentQ.data?.proposalId;
  const proposalQ = useQuery({
    queryKey: ["incident-proposal", proposalId],
    queryFn: ({ signal }) => getProposal(proposalId as string, undefined, signal),
    enabled: Boolean(proposalId),
    retry: false,
  });
  const [copyState, setCopyState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  async function copyMarkdown() {
    setCopyState("busy");
    try {
      const md = await getIncidentMarkdown(id);
      setCopyState((await copyToClipboard(md)) ? "done" : "failed");
    } catch {
      setCopyState("failed");
    }
  }

  const notFound = incidentQ.error instanceof ApiFailure && incidentQ.error.status === 404;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <style>{PRINT_CSS}</style>
      <nav data-print-hide aria-label={fa.incidents.title}>
        <Link href="/incidents" className="inline-flex min-h-11 items-center gap-1 text-sm text-accent underline">
          <ChevronRight aria-hidden className="size-4 ltr:-scale-x-100" />
          {l.backToList}
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold leading-10">
          {l.reportTitle}{" "}
          <bdi dir="ltr" className="font-mono text-xl">
            {id}
          </bdi>
        </h1>
        <div data-print-hide className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void copyMarkdown()} loading={copyState === "busy"} disabled={!incidentQ.data}>
            {l.copyMarkdown}
          </Button>
          <Button variant="secondary" onClick={() => window.print()} disabled={!incidentQ.data}>
            <Printer aria-hidden className="size-4" />
            {l.print}
          </Button>
        </div>
      </header>
      <p role="status" aria-live="polite" className="min-h-6 text-sm text-muted" data-print-hide>
        {copyState === "done" ? l.copyMarkdownDone : copyState === "failed" ? l.copyMarkdownFailed : ""}
      </p>

      {incidentQ.isPending ? (
        <div aria-busy className="flex flex-col gap-3">
          <p className="sr-only">{fa.common.loading}</p>
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : incidentQ.isError ? (
        notFound ? (
          <ErrorBanner tone="warn" message={l.notFound} />
        ) : (
          <ErrorBanner title={l.loadFailed} message={fa.errors.neverFabricated} onRetry={() => void incidentQ.refetch()} retrying={incidentQ.isFetching} />
        )
      ) : (
        <Report incident={incidentQ.data} proposal={proposalQ.data} proposalFailed={proposalQ.isError} />
      )}
    </div>
  );
}
