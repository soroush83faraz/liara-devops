"use client";

import { Check, CircleCheck, CircleX, Clock, Coins, LoaderCircle, Lock, TriangleAlert, Undo2, WandSparkles, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ExecutionData, Observation, Proposal, ProposalStatus, VerificationData } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { faPrice } from "@/lib/i18n/format";
import { rejectProposal } from "@/lib/copilot/api";
import { requirements } from "@/lib/copilot/approval";
import { useCopilotStore } from "@/lib/copilot/store";
import { fill, formatCountdown, stripUnsafeChars } from "@/lib/copilot/text";
import { ApprovalDialog, actionLabel } from "./approval-dialog";
import { ExecutionProgress } from "./execution-progress";
import { MockDataBadge } from "./mock-data-badge";
import { SafeMarkdown } from "./safe-markdown";
import { Template } from "./template";
import { useNow } from "./use-now";
import { useProposalFollow } from "./use-proposal-follow";
import { TierBadge } from "./tier-badge";
import { VerificationBody, VerificationPending } from "./verification-card";
import { cn } from "@/lib/utils";

const l = fa.copilotUi.proposal;

const STATUS_META: Record<ProposalStatus, { tone: "accent" | "ok" | "warn" | "danger" | "neutral"; icon: LucideIcon }> = {
  proposed: { tone: "accent", icon: Clock },
  approved: { tone: "accent", icon: Check },
  executing: { tone: "accent", icon: LoaderCircle },
  verifying: { tone: "accent", icon: LoaderCircle },
  verified: { tone: "ok", icon: CircleCheck },
  not_verified: { tone: "warn", icon: TriangleAlert },
  failed: { tone: "danger", icon: CircleX },
  rejected: { tone: "neutral", icon: CircleX },
  expired: { tone: "neutral", icon: Clock },
  stale: { tone: "warn", icon: TriangleAlert },
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const spin = status === "executing" || status === "verifying";
  return (
    <Badge tone={meta.tone} className="gap-1.5">
      <Icon aria-hidden className={spin ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"} />
      {l.status[status]}
    </Badge>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h5 className="text-xs font-semibold text-muted">{label}</h5>
      <div className="text-[15px] leading-8">{children}</div>
    </div>
  );
}

/** Small fact tile (reversibility, cost): label over value, icon carries the kind. */
function Fact({ icon: Icon, label, children, tone }: { icon: LucideIcon; label: string; children: React.ReactNode; tone?: "warn" | "danger" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-sm border p-2.5",
        tone === "danger" ? "border-danger/35 bg-danger-soft/50" : tone === "warn" ? "border-warn/35 bg-warn-soft/50" : "border-border bg-surface-muted/50",
      )}
    >
      <Icon aria-hidden className={cn("mt-1 size-4 shrink-0", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-muted")} />
      <div className="flex min-w-0 flex-col">
        <h5 className="text-xs font-semibold text-muted">{label}</h5>
        <div className="text-sm font-medium leading-7">{children}</div>
      </div>
    </div>
  );
}

/**
 * A typed proposal: why, effect, risks, reversibility, cost, verification plan, tier. Mutations happen only via the
 * approval dialog; execution progress and the verification result render inside the same card.
 */
export function ProposalCard({
  proposal,
  executions,
  verification,
  threadKey,
  incidentId,
  observations,
  onOpenEvidence,
  onReevaluate,
}: {
  proposal: Proposal;
  executions: ExecutionData[];
  verification?: VerificationData;
  threadKey: string;
  incidentId?: string;
  observations: Map<string, Observation>;
  onOpenEvidence: (o: Observation) => void;
  onReevaluate: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectFailed, setRejectFailed] = useState(false);
  const apply = useCopilotStore((s) => s.applyProposalChunk);

  const status = proposal.status;
  const req = requirements(proposal);
  const waiting = status === "proposed";
  const now = useNow(1000, waiting);
  const remaining = Date.parse(proposal.expiresAt) - now;
  const expiredLocally = waiting && remaining <= 0;
  const active = submitted || status === "executing" || status === "verifying";
  const follow = useProposalFollow(threadKey, proposal.id, active);
  const showExecution = status !== "proposed" && status !== "rejected" && status !== "expired" && status !== "stale";

  async function reject() {
    if (rejecting) return;
    setRejecting(true);
    setRejectFailed(false);
    try {
      const updated = await rejectProposal(proposal.id);
      apply(threadKey, proposal.id, { type: "data-proposal", id: proposal.id, data: updated ?? { ...proposal, status: "rejected" } });
    } catch {
      setRejectFailed(true);
    } finally {
      setRejecting(false);
    }
  }

  return (
    <Card
      aria-label={l.title}
      data-status={status}
      className={cn(
        "relative overflow-hidden",
        req.tier === 3 || req.humanOnly ? "border-danger/45" : req.tier === 2 ? "border-warn/40" : waiting ? "border-accent/40" : undefined,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-px",
          req.tier === 3 || req.humanOnly ? "bg-danger" : req.tier === 2 ? "bg-warn" : waiting ? "bg-accent" : "bg-transparent",
        )}
      />
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex size-7 items-center justify-center rounded-sm bg-accent-soft text-accent-ink">
            <WandSparkles className="size-4" />
          </span>
          <h3 className="text-base font-bold leading-8">{l.title}</h3>
          <StatusBadge status={status} />
          <MockDataBadge />
          <span className="ms-auto">
            <TierBadge tier={req.tier} />
          </span>
        </div>

        <div className="flex flex-col gap-0.5 rounded-sm border border-border bg-surface-muted/50 px-3 py-2.5">
          <p className="text-[17px] font-bold leading-8">{actionLabel(proposal.type)}</p>
          <p className="text-sm text-muted">
            <Template template={fa.copilotUi.approval.targetLine} params={{ target: proposal.target.name }} />
          </p>
        </div>

        {req.humanOnly ? (
          <div role="alert" className="flex items-start gap-2 rounded-sm border border-danger/40 bg-danger-soft p-3 text-sm leading-7 text-danger-ink">
            <Lock aria-hidden className="mt-1 size-4 shrink-0" />
            <div>
              <p className="font-semibold">{l.humanOnlyTitle}</p>
              <p>{l.humanOnlyBody}</p>
            </div>
          </div>
        ) : null}

        <Field label={l.why}>
          <SafeMarkdown text={proposal.rationaleFa} />
          {proposal.evidenceIds.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">{l.evidence}:</span>
              {proposal.evidenceIds.map((id) => {
                const o = observations.get(id);
                return o ? (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onOpenEvidence(o)}
                    className="min-h-11 rounded-full border border-border bg-surface px-3 text-xs hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-8"
                    aria-label={fill(fa.copilotUi.evidence.open, { id })}
                  >
                    <bdi dir="ltr" className="font-mono">
                      {id}
                    </bdi>
                  </button>
                ) : (
                  <bdi key={id} dir="ltr" className="font-mono text-xs">
                    {id}
                  </bdi>
                );
              })}
            </div>
          ) : null}
        </Field>
        <Field label={l.effect}>
          <SafeMarkdown text={proposal.effectFa} />
        </Field>
        {proposal.risksFa.length > 0 ? (
          <Field label={l.risks}>
            <ul className="ms-5 list-disc">
              {proposal.risksFa.map((r, i) => (
                <li key={i}>{stripUnsafeChars(r)}</li>
              ))}
            </ul>
          </Field>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Fact icon={Undo2} label={l.reversible} tone={proposal.reversible === "no" ? "danger" : proposal.reversible === "partly" ? "warn" : undefined}>
            {proposal.reversible === "yes" ? l.reversibleYes : proposal.reversible === "partly" ? l.reversiblePartly : l.reversibleNo}
          </Fact>
          <Fact icon={Coins} label={l.cost} tone={proposal.costEstimate ? "warn" : undefined}>
            {proposal.costEstimate
              ? fill(fa.copilotUi.approval.costLine, {
                  hourly: faPrice(proposal.costEstimate.perHourToman),
                  monthly: faPrice(proposal.costEstimate.perMonthToman),
                })
              : l.noCost}
          </Fact>
        </div>
        <Field label={l.verificationPlan}>
          <ul className="ms-5 list-disc">
            {proposal.verificationPlan.map((v, i) => (
              <li key={i}>{stripUnsafeChars(v)}</li>
            ))}
          </ul>
        </Field>

        {waiting && !req.humanOnly ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            {expiredLocally ? (
              <p role="status" className="text-sm text-warn-ink">
                {l.expired}
              </p>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Clock aria-hidden className="size-3.5" />
                <Template template={l.expiresIn} params={{ time: formatCountdown(remaining) }} />
              </p>
            )}
            {rejectFailed ? (
              <p role="alert" className="text-sm text-danger">
                {l.rejectFailed}
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              {expiredLocally ? (
                <Button onClick={onReevaluate}>{fa.copilotUi.approval.reevaluate}</Button>
              ) : (
                <Button onClick={() => setDialogOpen(true)} variant={req.tier === 3 ? "danger" : "primary"}>
                  {l.review}
                </Button>
              )}
              <Button variant="secondary" onClick={() => void reject()} loading={rejecting} loadingText={l.rejecting}>
                {l.reject}
              </Button>
            </div>
          </div>
        ) : null}

        {showExecution && (executions.length > 0 || status === "approved" || status === "executing" || status === "verifying") ? (
          <ExecutionProgress executions={executions} status={status} follow={follow.state} onRefresh={follow.refresh} />
        ) : null}

        {verification ? (
          <VerificationBody result={verification.result} incidentId={incidentId} />
        ) : status === "executing" || status === "verifying" ? (
          <VerificationPending />
        ) : null}
      </CardContent>

      <ApprovalDialog
        proposal={proposal}
        threadKey={threadKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmitted={() => setSubmitted(true)}
        onReevaluate={onReevaluate}
      />
    </Card>
  );
}
