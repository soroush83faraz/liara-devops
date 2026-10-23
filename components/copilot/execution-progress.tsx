"use client";

import { Circle, CircleCheck, CircleMinus, CircleX, Info, LoaderCircle, RefreshCw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExecutionData, ProposalStatus, StepStatus } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import { cn } from "@/lib/utils";
import type { FollowState } from "./use-proposal-follow";

const l = fa.copilotUi.execution;

const ICON: Record<StepStatus, { icon: LucideIcon; cls: string }> = {
  pending: { icon: Circle, cls: "text-muted" },
  running: { icon: LoaderCircle, cls: "animate-spin text-accent motion-reduce:animate-none" },
  done: { icon: CircleCheck, cls: "text-ok" },
  failed: { icon: CircleX, cls: "text-danger" },
  skipped: { icon: CircleMinus, cls: "text-muted" },
};

export function stepName(step: string): string {
  const known = (l.stepNames as Record<string, string>)[step];
  return known ?? fill(l.stepFallback, { step });
}

/**
 * Stepper fed by `data-execution` parts. Once the request is submitted it cannot be cancelled, and the card says so
 * (the only honest control is the verification that follows).
 */
export function ExecutionProgress({
  executions,
  status,
  follow,
  onRefresh,
}: {
  executions: ExecutionData[];
  status: ProposalStatus;
  follow: FollowState;
  onRefresh: () => void;
}) {
  const live = status === "approved" || status === "executing" || status === "verifying";
  return (
    <section aria-label={l.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted/50 p-3">
      <h4 className="text-sm font-semibold">{l.title}</h4>
      {live ? (
        <p className="flex items-start gap-2 text-xs leading-6 text-muted">
          <Info aria-hidden className="mt-1 size-3.5 shrink-0" />
          {l.cannotCancel}
        </p>
      ) : null}
      {executions.length === 0 ? (
        live ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            {l.waiting}
          </p>
        ) : null
      ) : (
        <ol aria-live="polite" aria-relevant="additions text" aria-label={l.statusLabel} className="flex flex-col">
          {executions.map((e) => {
            const meta = ICON[e.status];
            const Icon = meta.icon;
            return (
              <li key={e.step} className="flex min-h-9 items-start gap-2.5 py-1 text-[15px] leading-7" data-status={e.status}>
                <Icon aria-hidden className={cn("mt-1.5 size-4 shrink-0", meta.cls)} />
                <span className="min-w-0 flex-1">
                  {stepName(e.step)}
                  <span className="ms-2 text-xs text-muted">({l.step[e.status]})</span>
                  {e.detail ? <span className="block text-xs leading-6 text-muted">{stripUnsafeChars(e.detail)}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {follow === "reconnecting" ? (
        <p role="status" className="text-xs text-warn-ink">
          {l.connectionLost}
        </p>
      ) : null}
      {follow === "lost" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-ink">
          <span>{l.connectionFailed}</span>
          <Button size="sm" variant="secondary" onClick={onRefresh}>
            <RefreshCw aria-hidden className="size-4" />
            {l.refresh}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
