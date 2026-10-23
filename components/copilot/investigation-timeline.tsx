"use client";

import { Circle, CircleCheck, CircleMinus, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Observation, StepData, StepStatus } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
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

/**
 * Investigation steps with live status (icon + text, never colour alone). The list is a polite live region so
 * screen readers hear step changes without interruption; collected observations sit under an expander.
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
    <section aria-label={l.title} className="rounded-xl border border-border bg-surface p-4">
      {steps.length > 0 ? (
        <>
          <h3 className="mb-2 text-sm font-semibold text-muted">{l.title}</h3>
          <ol aria-live="polite" aria-relevant="additions text" aria-busy={busy} className="flex flex-col gap-1">
            {steps.map((s) => {
              const meta = ICON[s.status];
              const Icon = meta.icon;
              return (
                <li key={s.id} className="flex min-h-9 items-start gap-2.5 py-1 text-[15px] leading-7" data-status={s.status}>
                  <Icon aria-hidden className={cn("mt-1.5 size-4 shrink-0", meta.cls)} />
                  <span className="min-w-0 flex-1">
                    <span>{stripUnsafeChars(s.label)}</span>
                    <span className="ms-2 text-xs text-muted">({l.stepStatus[s.status]})</span>
                    {s.detail ? <span className="block text-xs leading-6 text-muted">{stripUnsafeChars(s.detail)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      {failed ? (
        <p role="status" className="mt-2 flex items-start gap-2 rounded-lg bg-warn-soft p-2.5 text-sm leading-7 text-warn-ink">
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
