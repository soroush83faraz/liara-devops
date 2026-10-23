"use client";

import { motion } from "motion/react";
import { Circle, CircleCheck, CircleMinus, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Observation, StepData, StepStatus } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import { ease, Pulse, spring } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";
import { EvidenceItem } from "./evidence-item";

const l = fa.copilotUi.timeline;

const ICON: Record<StepStatus, { icon: LucideIcon; cls: string }> = {
  pending: { icon: Circle, cls: "text-muted" },
  running: { icon: LoaderCircle, cls: "animate-spin text-accent motion-reduce:animate-none" },
  done: { icon: CircleCheck, cls: "text-ok" },
  failed: { icon: CircleX, cls: "text-danger" },
  skipped: { icon: CircleMinus, cls: "text-muted" },
};

/** Status glyph that pops when the step changes state (keyed by status), sitting on the timeline rail. */
export function StepGlyph({ status }: { status: StepStatus }) {
  const meta = ICON[status];
  const Icon = meta.icon;
  return (
    <span className="relative z-[1] mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface">
      {status === "running" ? <span aria-hidden className="absolute inset-0 rounded-full bg-accent/25 animate-hl-ping" /> : null}
      <motion.span key={status} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.pop} className="flex">
        <Icon aria-hidden className={cn("size-4", meta.cls)} />
      </motion.span>
    </span>
  );
}

/**
 * Investigation steps with live status (icon + text, never colour alone). The list is a polite live region so
 * screen readers hear step changes without interruption; collected observations sit under an expander.
 * Steps hang off a rail that fills in as they complete.
 */
export function InvestigationTimeline({
  steps,
  observations,
  onOpenEvidence,
}: {
  steps: StepData[];
  observations: Observation[];
  onOpenEvidence?: (o: Observation) => void;
}) {
  const busy = steps.some((s) => s.status === "running" || s.status === "pending");
  const failed = steps.some((s) => s.status === "failed");
  return (
    <section aria-label={l.title} className="rounded-md border border-border bg-surface p-4">
      {steps.length > 0 ? (
        <>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
            {busy ? <Pulse tone="accent" /> : <span aria-hidden className="size-2 rounded-full bg-border-strong/60" />}
            {l.title}
          </h3>
          <ol aria-live="polite" aria-relevant="additions text" aria-busy={busy} className="relative flex flex-col">
            {steps.map((s, i) => (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: ease.out }}
                className="relative flex min-h-9 items-start gap-3 py-1 text-[15px] leading-7"
                data-status={s.status}
              >
                {i < steps.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute start-[9px] top-7 bottom-[-6px] w-px transition-colors duration-500",
                      s.status === "done" ? "bg-ok/50" : s.status === "failed" ? "bg-danger/40" : "bg-border",
                    )}
                  />
                ) : null}
                <StepGlyph status={s.status} />
                <span className="min-w-0 flex-1">
                  <span className={cn(s.status === "pending" && "text-muted")}>{stripUnsafeChars(s.label)}</span>
                  <span className="ms-2 text-xs text-muted">({l.stepStatus[s.status]})</span>
                  {s.detail ? <span className="block text-xs leading-6 text-muted">{stripUnsafeChars(s.detail)}</span> : null}
                </span>
              </motion.li>
            ))}
          </ol>
        </>
      ) : null}
      {failed ? (
        <p role="status" className="mt-2 flex items-start gap-2 rounded-sm bg-warn-soft p-2.5 text-sm leading-7 text-warn-ink">
          <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
          {l.partialWarning}
        </p>
      ) : null}
      {observations.length > 0 ? (
        <Disclosure className="mt-2 border-t border-border pt-1" summary={fill(l.rawDataCount, { count: observations.length })}>
          <ul className="flex flex-col gap-2">
            {observations.map((o) => (
              <li key={o.id}>
                <EvidenceItem observation={o} onOpen={onOpenEvidence} />
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </section>
  );
}
