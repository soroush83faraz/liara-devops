"use client";

import { RotateCcw, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Observation } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { groupTurn, hasIncompleteEvidence, type Block } from "@/lib/copilot/blocks";
import type { Thread, Turn } from "@/lib/copilot/thread";
import { CopilotErrorBanner, ErrorCard } from "./copilot-error";
import { EvidenceDrawer } from "./evidence-drawer";
import { FindingCard } from "./finding-card";
import { IncidentButton } from "./incident-button";
import { InvestigationTimeline } from "./investigation-timeline";
import { LlmDegradeBanner } from "./llm-degrade-banner";
import { ProposalCard } from "./proposal-card";
import { SafeMarkdown } from "./safe-markdown";
import { ExecutionProgress } from "./execution-progress";
import { VerificationBody } from "./verification-card";

const p = fa.copilotUi.panel;

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="sr-only">{p.you}</span>
      <p dir="auto" className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-accent-soft px-4 py-2 text-[15px] leading-8 text-accent-ink">
        {text}
      </p>
    </div>
  );
}

function allObservations(thread: Thread): Map<string, Observation> {
  const map = new Map<string, Observation>();
  for (const t of thread.turns) {
    for (const c of t.cards) {
      if (c.kind === "observation") map.set(c.data.id, c.data);
      if (c.kind === "finding") for (const o of c.data.facts) map.set(o.id, o);
    }
  }
  return map;
}

export function ThreadView({
  thread,
  threadKey,
  onRetry,
  onStop,
  onReevaluate,
}: {
  thread: Thread;
  threadKey: string;
  onRetry: () => void;
  onStop: () => void;
  onReevaluate: () => void;
}) {
  const [drawer, setDrawer] = useState<Observation | null>(null);
  const observations = useMemo(() => allObservations(thread), [thread]);
  const last = thread.turns[thread.turns.length - 1];

  return (
    <div className="flex flex-col gap-5">
      {thread.turns.map((turn) => (
        <TurnView
          key={turn.id}
          turn={turn}
          thread={thread}
          threadKey={threadKey}
          observations={observations}
          onOpenEvidence={setDrawer}
          onReevaluate={onReevaluate}
          isLast={turn === last}
          onRetry={onRetry}
          onStop={onStop}
        />
      ))}
      <EvidenceDrawer observation={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

function TurnView({
  turn,
  thread,
  threadKey,
  observations,
  onOpenEvidence,
  onReevaluate,
  isLast,
  onRetry,
  onStop,
}: {
  turn: Turn;
  thread: Thread;
  threadKey: string;
  observations: Map<string, Observation>;
  onOpenEvidence: (o: Observation) => void;
  onReevaluate: () => void;
  isLast: boolean;
  onRetry: () => void;
  onStop: () => void;
}) {
  const blocks = useMemo(() => groupTurn(turn, thread), [turn, thread]);
  const incompleteEvidence = hasIncompleteEvidence(turn);
  const incidentId = useMemo(() => {
    for (const t of thread.turns) for (const c of t.cards) if (c.kind === "incident") return c.data.id;
    return undefined;
  }, [thread]);
  const incidentForProposal = (proposalId: string) => {
    for (const t of thread.turns) for (const c of t.cards) if (c.kind === "incident" && c.data.proposalId === proposalId) return c.data.id;
    return incidentId;
  };

  return (
    <article aria-label={p.assistant} className="flex flex-col gap-3" data-turn-status={turn.status}>
      {turn.userText ? <UserBubble text={turn.userText} /> : null}
      <div className="flex flex-col gap-3">
        {turn.degraded ? <LlmDegradeBanner /> : null}
        {blocks.map((b) => (
          <BlockView
            key={b.key}
            block={b}
            threadKey={threadKey}
            observations={observations}
            incompleteEvidence={incompleteEvidence}
            degraded={turn.degraded}
            onOpenEvidence={onOpenEvidence}
            onReevaluate={onReevaluate}
            incidentForProposal={incidentForProposal}
            onRetry={isLast ? onRetry : undefined}
          />
        ))}
        {turn.invalidParts > 0 ? (
          <p role="status" className="text-xs text-warn-ink">
            {p.invalidParts}
          </p>
        ) : null}
        {turn.status === "streaming" ? (
          <div className="flex flex-col gap-2" role="status" aria-live="polite">
            <p className="text-sm text-muted">{p.working}</p>
            {blocks.length === 0 ? <Skeleton className="h-16 w-full" /> : null}
            {isLast ? (
              <Button variant="secondary" size="sm" className="self-start" onClick={onStop}>
                <Square aria-hidden className="size-4" />
                {p.stop}
              </Button>
            ) : null}
          </div>
        ) : null}
        {turn.status === "aborted" ? (
          <div role="status" className="flex flex-col gap-2 rounded-lg bg-surface-muted p-3 text-sm leading-7">
            <p className="font-medium">{p.stopped}</p>
            <p className="text-muted">{p.stoppedHint}</p>
            {isLast ? (
              <Button variant="secondary" size="sm" className="self-start" onClick={onRetry}>
                <RotateCcw aria-hidden className="size-4" />
                {p.retry}
              </Button>
            ) : null}
          </div>
        ) : null}
        {turn.status === "error" && isLast && thread.error ? <CopilotErrorBanner error={thread.error} onRetry={onRetry} /> : null}
      </div>
    </article>
  );
}

function BlockView({
  block,
  threadKey,
  observations,
  incompleteEvidence,
  degraded,
  onOpenEvidence,
  onReevaluate,
  incidentForProposal,
  onRetry,
}: {
  block: Block;
  threadKey: string;
  observations: Map<string, Observation>;
  incompleteEvidence: boolean;
  degraded: boolean;
  onOpenEvidence: (o: Observation) => void;
  onReevaluate: () => void;
  incidentForProposal: (proposalId: string) => string | undefined;
  onRetry?: () => void;
}) {
  switch (block.kind) {
    case "text":
      return <SafeMarkdown text={block.card.text} />;
    case "timeline":
      return (
        <InvestigationTimeline
          steps={block.steps.map((s) => s.data)}
          observations={block.observations.map((o) => o.data)}
          onOpenEvidence={onOpenEvidence}
        />
      );
    case "finding":
      return <FindingCard finding={block.card.data} incomplete={incompleteEvidence} degraded={degraded} onOpenEvidence={onOpenEvidence} />;
    case "proposal":
      return (
        <ProposalCard
          proposal={block.proposal}
          executions={block.executions}
          verification={block.verification}
          threadKey={threadKey}
          incidentId={incidentForProposal(block.proposal.id)}
          observations={observations}
          onOpenEvidence={onOpenEvidence}
          onReevaluate={onReevaluate}
        />
      );
    case "orphan":
      return (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          {block.executions.length > 0 ? (
            <ExecutionProgress executions={block.executions} status="executing" follow="idle" onRefresh={() => undefined} />
          ) : null}
          {block.verification ? <VerificationBody result={block.verification.result} /> : null}
        </div>
      );
    case "incident":
      return <IncidentButton incidentId={block.card.data.id} />;
    case "error":
      return <ErrorCard data={block.card.data} detail={block.card.detail} onRetry={onRetry} />;
  }
}
