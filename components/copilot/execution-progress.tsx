"use client";

import { Info, LoaderCircle, RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import type { ExecutionData, ProposalStatus } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { faNumber } from "@/lib/i18n/format";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import { ease, Pulse } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { StepGlyph } from "./investigation-timeline";
import type { FollowState } from "./use-proposal-follow";

const l = fa.copilotUi.execution;

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
  const total = executions.length;
  const settled = executions.filter((e) => e.status === "done" || e.status === "skipped" || e.status === "failed").length;
  const anyFailed = executions.some((e) => e.status === "failed");
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: ease.out }}
      aria-label={l.title}
      className={cn("flex flex-col gap-2.5 rounded-md border bg-surface-muted/40 p-3.5", live ? "border-accent/35" : "border-border")}
    >
      <div className="flex items-center gap-2">
        {live ? <Pulse tone="accent" /> : null}
        <h4 className="flex-1 text-sm font-semibold">{l.title}</h4>
        {total > 0 ? (
          <span aria-hidden className="text-xs font-semibold tabular-nums text-muted">
            {faNumber(settled)} / {faNumber(total)}
          </span>
        ) : null}
      </div>
      {total > 0 ? (
        <div aria-hidden className={cn("relative h-1 overflow-hidden rounded-full", anyFailed ? "bg-danger-soft" : "bg-accent-soft")}>
          <span
            className={cn(
              "absolute inset-0 origin-right rounded-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ltr:origin-left",
              anyFailed ? "bg-danger" : settled === total ? "bg-ok" : "bg-accent",
            )}
            style={{ transform: `scaleX(${settled / total})` }}
          />
        </div>
      ) : null}
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
          {executions.map((e, i) => {
            return (
              <motion.li
                key={e.step}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: ease.out }}
                className="relative flex min-h-9 items-start gap-3 py-1 text-[15px] leading-7"
                data-status={e.status}
              >
                {i < executions.length - 1 ? (
                  <span aria-hidden className={cn("absolute start-[9px] top-7 bottom-[-6px] w-px", e.status === "done" ? "bg-ok/50" : "bg-border")} />
                ) : null}
                <StepGlyph status={e.status} />
                <span className="min-w-0 flex-1">
                  {stepName(e.step)}
                  <span className="ms-2 text-xs text-muted">({l.step[e.status]})</span>
                  {e.detail ? <span className="block text-xs leading-6 text-muted">{stripUnsafeChars(e.detail)}</span> : null}
                </span>
              </motion.li>
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
    </motion.section>
  );
}
