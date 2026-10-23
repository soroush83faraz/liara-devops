"use client";

import { CircleAlert, CircleCheck, Eye, EyeOff, Info, Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { matchesName } from "@/components/ui/confirm-match";
import type { Proposal } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { faPrice } from "@/lib/i18n/format";
import { approveProposal, executeProposal, getProposal } from "@/lib/copilot/api";
import {
  approveSucceeded,
  beginSubmit,
  canConfirm,
  executeSucceeded,
  failed,
  initialState,
  requirements,
  setTypedName,
  setValue,
  statusChecked,
  tick,
  type ApprovalState,
  type Stage,
} from "@/lib/copilot/approval";
import { buildDiff } from "@/lib/copilot/diff";
import { classifyFailure } from "@/lib/copilot/stream-client";
import { useCopilotStore } from "@/lib/copilot/store";
import { fill, formatCountdown, stripUnsafeChars } from "@/lib/copilot/text";
import { DiffView } from "./diff-view";
import { SafeMarkdown } from "./safe-markdown";
import { TechnicalRequestView } from "./technical-request-view";
import { Template } from "./template";
import { useNow } from "./use-now";

const l = fa.copilotUi.approval;
const p = fa.copilotUi.proposal;

export const actionLabel = (type: Proposal["type"]): string => fa.copilotUi.actions[type];

export interface ApprovalDialogProps {
  proposal: Proposal;
  /** Thread key of the owning service panel (updates the proposal card in place). */
  threadKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The execute request was accepted (202): the card now follows the event stream. */
  onSubmitted: () => void;
  /** «ارزیابی دوباره»: ask the copilot to re-read the evidence and propose again. */
  onReevaluate: () => void;
}

export function ApprovalDialog(props: ApprovalDialogProps) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <ApprovalBody {...props} /> : null}
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-semibold text-muted">{label}</h4>
      <div className="text-[15px] leading-8">{children}</div>
    </div>
  );
}

function UserValueField({
  keyName,
  value,
  onChange,
  disabled,
}: {
  keyName: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm">
        <Template template={l.userValueLabel} params={{ key: keyName }} />
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          dir="ltr"
          // Held in component state only; never in a query cache, storage, URL or log.
          type={shown ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 text-start font-mono"
        />
        <IconButton
          label={shown ? l.userValueHide : l.userValueShow}
          icon={shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          onClick={() => setShown(!shown)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function PhaseNotice({ state, onReevaluate }: { state: ApprovalState; onReevaluate: () => void }) {
  const ph = l.phase;
  const status = state.blockedStatus ? p.status[state.blockedStatus] : "";
  const map: Partial<Record<ApprovalState["phase"], { text: string; hint?: string; tone: "danger" | "warn" | "info"; reevaluate?: boolean }>> = {
    stale: { text: ph.stale, hint: ph.staleHint, tone: "warn", reevaluate: true },
    expired: { text: ph.expired, hint: ph.expiredHint, tone: "warn", reevaluate: true },
    conflict: { text: ph.conflict, tone: "warn" },
    rejected: { text: ph.rejected, tone: "info" },
    unauthorized: { text: ph.unauthorized, tone: "danger" },
    forbidden: { text: ph.forbidden, tone: "danger" },
    rate_limited: { text: fill(ph.rateLimited, { seconds: state.retryAfterSec ?? 30 }), tone: "warn" },
    unknown_result: { text: ph.unknownResult, tone: "danger" },
    blocked:
      state.blockedReason === "human_only"
        ? { text: ph.humanOnly, tone: "danger" }
        : { text: fill(ph.alreadyDone, { status }), tone: "info" },
    error: {
      text:
        state.errorReason === "bad_name"
          ? ph.badName
          : state.errorReason === "network"
            ? ph.network
            : ph.generic,
      tone: "danger",
    },
  };
  const entry = map[state.phase] ?? (state.notStarted ? { text: ph.notStarted, tone: "info" as const } : undefined);
  if (!entry) return null;
  const Icon = entry.tone === "info" ? Info : entry.tone === "warn" ? TriangleAlert : CircleAlert;
  const toneCls =
    entry.tone === "danger"
      ? "border-danger/40 bg-danger-soft text-danger-ink"
      : entry.tone === "warn"
        ? "border-warn/40 bg-warn-soft text-warn-ink"
        : "border-border bg-surface-muted text-foreground";
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border p-3 text-sm leading-7 ${toneCls}`}>
      <Icon aria-hidden className="mt-1 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <p>{entry.text}</p>
        {entry.hint ? <p className="opacity-90">{entry.hint}</p> : null}
        {state.phase === "unauthorized" ? (
          <Link href="/connect" className="font-medium underline">
            {fa.copilotUi.errors.reconnect}
          </Link>
        ) : null}
        {entry.reevaluate ? (
          <div>
            <Button size="sm" variant="secondary" onClick={onReevaluate}>
              {l.reevaluate}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ApprovalBody({ proposal, threadKey, onOpenChange, onSubmitted, onReevaluate }: ApprovalDialogProps) {
  const req = useMemo(() => requirements(proposal), [proposal]);
  const [state, setState] = useState<ApprovalState>(() => initialState(proposal, Date.now()));
  const stateRef = useRef(state);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const nameId = useId();

  const commit = useCallback((next: ApprovalState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const interactive = state.phase === "review" || state.phase === "error";
  const now = useNow(1000, interactive);
  useEffect(() => {
    const next = tick(stateRef.current, proposal, now);
    if (next !== stateRef.current) commit(next);
  }, [now, proposal, commit]);

  const busy = state.phase === "approving" || state.phase === "executing";
  const diff = useMemo(() => buildDiff(proposal.params), [proposal.params]);
  const confirmEnabled = canConfirm(state, proposal, now);
  const remaining = Date.parse(proposal.expiresAt) - now;
  const nameOk = matchesName(state.typedName, proposal.target.name);

  const submit = useCallback(async () => {
    if (inFlight.current) return; // double click / Enter while a request is running
    const begun = beginSubmit(stateRef.current, proposal, Date.now());
    if (!begun) return;
    inFlight.current = true;
    commit(begun.state);
    let userValues: Record<string, string> | undefined = begun.payload.userValues;
    let stage: Stage = "approve";
    try {
      const approved = await approveProposal(proposal.id, { typedName: begun.payload.typedName });
      commit(approveSucceeded(stateRef.current));
      if (approved.proposal) {
        useCopilotStore.getState().applyProposalChunk(threadKey, proposal.id, { type: "data-proposal", id: proposal.id, data: approved.proposal });
      }
      stage = "execute";
      await executeProposal(proposal.id, { approvalToken: approved.approvalToken, userValues });
      commit(executeSucceeded(stateRef.current));
      onSubmitted();
    } catch (err) {
      commit(failed(stateRef.current, stage, classifyFailure(err)));
    } finally {
      // The typed secrets existed only in this closure and the request body; drop every reference now.
      if (userValues) for (const k of Object.keys(userValues)) delete userValues[k];
      userValues = undefined;
      inFlight.current = false;
    }
  }, [proposal, threadKey, commit, onSubmitted]);

  const checkStatus = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const fresh = await getProposal(proposal.id);
      useCopilotStore.getState().applyProposalChunk(threadKey, proposal.id, { type: "data-proposal", id: proposal.id, data: fresh });
      const next = statusChecked(stateRef.current, fresh.status);
      commit(next);
      if (next.phase === "submitted") onSubmitted();
    } catch {
      // status still unknown: the notice stays and the user can try again
    } finally {
      inFlight.current = false;
    }
  }, [proposal.id, threadKey, commit, onSubmitted]);

  const title = fill(l.title, { action: actionLabel(proposal.type) });
  const showForm = interactive || busy;
  const submitted = state.phase === "submitted";
  const terminalNotice = !showForm && !submitted;

  return (
    <DialogContent
      title={title}
      description={l.description}
      size="lg"
      footer={
        submitted ? (
          <Button onClick={() => onOpenChange(false)}>{l.close}</Button>
        ) : state.phase === "unknown_result" ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {l.close}
            </Button>
            <Button onClick={() => void checkStatus()}>{l.checkStatus}</Button>
          </>
        ) : terminalNotice ? (
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {l.close}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              {l.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={!confirmEnabled}
              loading={busy}
              loadingText={l.working}
              onClick={() => void submit()}
            >
              {req.billed ? l.confirmBilled : l.confirmSimple}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {submitted ? (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-ok/40 bg-ok-soft p-3 text-ok-ink">
            <CircleCheck aria-hidden className="mt-1 size-5 shrink-0" />
            <div className="flex flex-col gap-1 text-sm leading-7">
              <p className="font-semibold">{l.done}</p>
              <p>{l.doneBody}</p>
            </div>
          </div>
        ) : null}

        <PhaseNotice
          state={state}
          onReevaluate={() => {
            onReevaluate();
            onOpenChange(false);
          }}
        />

        {!submitted ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={req.tier === 1 ? "accent" : "warn"}>
                {req.tier === 1 ? p.tier.one : req.tier === 2 ? p.tier.two : p.tier.three}
              </Badge>
              <span className="text-sm text-muted">
                <Template template={l.targetLine} params={{ target: proposal.target.name }} />
              </span>
              {interactive ? (
                <span className="ms-auto text-xs text-muted">
                  <Template template={p.expiresIn} params={{ time: formatCountdown(remaining) }} />
                </span>
              ) : null}
            </div>

            <Row label={p.why}>
              <SafeMarkdown text={proposal.rationaleFa} />
            </Row>
            <Row label={p.effect}>
              <SafeMarkdown text={proposal.effectFa} />
            </Row>
            {proposal.risksFa.length > 0 ? (
              <Row label={p.risks}>
                <ul className="ms-5 list-disc">
                  {proposal.risksFa.map((r, i) => (
                    <li key={i}>{stripUnsafeChars(r)}</li>
                  ))}
                </ul>
              </Row>
            ) : null}
            <Row label={p.reversible}>
              {proposal.reversible === "yes" ? p.reversibleYes : proposal.reversible === "partly" ? p.reversiblePartly : p.reversibleNo}
            </Row>

            <section aria-labelledby="ap-changes" className="flex flex-col gap-2">
              <h4 id="ap-changes" className="text-xs font-semibold text-muted">
                {l.changes}
              </h4>
              <DiffView lines={diff} />
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Lock aria-hidden className="size-3.5" />
                {l.valuesHidden}
              </p>
            </section>

            {req.billed ? (
              <div className="flex flex-col gap-1 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
                {proposal.costEstimate ? (
                  <p className="font-semibold">
                    {fill(l.costLine, {
                      hourly: faPrice(proposal.costEstimate.perHourToman),
                      monthly: faPrice(proposal.costEstimate.perMonthToman),
                    })}
                  </p>
                ) : null}
                <p>{l.costBilledNote}</p>
              </div>
            ) : (
              <p className="text-xs text-muted">{p.noCost}</p>
            )}

            <Row label={p.verificationPlan}>
              <ul className="ms-5 list-disc">
                {proposal.verificationPlan.map((v, i) => (
                  <li key={i}>{stripUnsafeChars(v)}</li>
                ))}
              </ul>
            </Row>

            {showForm && req.userKeys.length > 0 ? (
              <section className="flex flex-col gap-3 rounded-lg border border-border p-3" aria-labelledby="ap-values">
                <div>
                  <h4 id="ap-values" className="text-sm font-semibold">
                    {l.userValueTitle}
                  </h4>
                  <p className="text-xs leading-6 text-muted">{l.userValueHint}</p>
                </div>
                {req.userKeys.map((k) => (
                  <UserValueField
                    key={k}
                    keyName={k}
                    value={state.values[k] ?? ""}
                    disabled={busy}
                    onChange={(v) => commit(setValue(stateRef.current, k, v))}
                  />
                ))}
              </section>
            ) : null}

            {showForm && req.typedName ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={nameId} className="text-sm leading-7">
                  {fill(l.typeName, { kind: proposal.target.kind === "db" ? fa.service.database : fa.service.app })}{" "}
                  <bdi dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono text-[0.9em] font-semibold">
                    {proposal.target.name}
                  </bdi>
                </label>
                <Input
                  id={nameId}
                  dir="ltr"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={state.typedName}
                  disabled={busy}
                  invalid={state.typedName.length > 0 && !nameOk}
                  aria-describedby={`${nameId}-status`}
                  onChange={(e) => commit(setTypedName(stateRef.current, e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  className="text-start font-mono"
                />
                <p id={`${nameId}-status`} role="status" aria-live="polite" className="min-h-6 text-xs leading-6 text-muted">
                  {state.typedName.length === 0 ? "" : nameOk ? l.typeNameMatch : l.typeNameMismatch}
                </p>
              </div>
            ) : null}

            <TechnicalRequestView params={proposal.params} />
          </>
        ) : null}
      </div>
    </DialogContent>
  );
}
