"use client";

import { ChevronLeft, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Observation } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { isoUtc, relativeTime } from "@/lib/i18n/format";
import { fill, stripUnsafeChars, truncate } from "@/lib/copilot/text";
import { cn } from "@/lib/utils";
import { LtrBlock } from "./ltr-block";

const l = fa.copilotUi.evidence;

export const kindLabel = (o: Pick<Observation, "kind">): string => l.kind[o.kind];
export const sourceLabel = (o: Pick<Observation, "source">): string => l.sources[o.source];

export function EvidenceTime({ ts }: { ts?: string }) {
  if (!ts) return <span className="text-muted">{l.noTime}</span>;
  let title: string | undefined;
  try {
    title = isoUtc(ts);
  } catch {
    title = undefined;
  }
  return (
    <time dateTime={ts} title={title}>
      {relativeTime(ts)}
    </time>
  );
}

export function FlaggedBadge({ withHint = false }: { withHint?: boolean }) {
  return (
    <span className="inline-flex flex-col gap-1">
      <Badge tone="danger" className="gap-1">
        <TriangleAlert aria-hidden className="size-3.5" />
        {l.flagged}
      </Badge>
      {withHint ? <span className="text-xs leading-6 text-muted">{l.flaggedHint}</span> : null}
    </span>
  );
}

const SEVERITY_TONE = { info: "neutral", warn: "warn", error: "danger" } as const;

/** Which release wrote the line behind this fact, when it is not the serving one (params set by the evidence engine). */
export function releaseNote(o: Pick<Observation, "params">): { label: string; hint?: string } | null {
  const tag = typeof o.params.releaseTag === "string" ? o.params.releaseTag : "?";
  if (o.params.historical === 1) return { label: fill(l.historical, { tag }), hint: l.historicalHint };
  if (o.params.release === "newer") return { label: fill(l.newerRelease, { tag }) };
  return null;
}

export function ReleaseBadge({ observation, withHint = false }: { observation: Pick<Observation, "params">; withHint?: boolean }) {
  const note = releaseNote(observation);
  if (!note) return null;
  return (
    <span className="inline-flex flex-col gap-1">
      <Badge tone="neutral" className="py-0">
        <bdi>{note.label}</bdi>
      </Badge>
      {withHint && note.hint ? <span className="text-xs leading-6 text-muted">{note.hint}</span> : null}
    </span>
  );
}

/**
 * One observation. `compact` renders a single tappable row that opens the evidence drawer; the default renders
 * the excerpt inline in an LTR block (used for the timeline's raw data).
 */
export function EvidenceItem({
  observation: o,
  onOpen,
  compact = false,
}: {
  observation: Observation;
  onOpen?: (o: Observation) => void;
  compact?: boolean;
}) {
  const excerpt = truncate(stripUnsafeChars(o.text).replace(/\s+/g, " "), 140);
  const header = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <bdi dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono text-xs">
        {o.id}
      </bdi>
      <span className="font-medium">{kindLabel(o)}</span>
      <Badge tone={SEVERITY_TONE[o.severity]} className="py-0">
        {l.severityLabel[o.severity]}
      </Badge>
      {o.flagged ? <FlaggedBadge /> : null}
      <ReleaseBadge observation={o} />
      <span className="text-xs text-muted">
        <EvidenceTime ts={o.ts} /> · {sourceLabel(o)}
      </span>
    </span>
  );

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onOpen?.(o)}
        aria-label={fill(l.open, { id: o.id })}
        className={cn(
          "flex min-h-11 w-full items-start justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-start",
          "hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className="flex min-w-0 flex-col gap-1">
          {header}
          <bdi dir="ltr" className="block truncate text-start font-mono text-xs text-muted">
            {excerpt}
          </bdi>
        </span>
        <ChevronLeft aria-hidden className="mt-1 size-4 shrink-0 text-muted ltr:-scale-x-100" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      {header}
      <LtrBlock text={stripUnsafeChars(o.text)} copy maxHeightClass="max-h-40" label={fill(l.itemLabel, { id: o.id })} />
    </div>
  );
}

export function observationDetailRows(o: Observation): Array<{ key: string; value: string }> {
  return Object.entries(o.params).map(([key, value]) => ({ key, value: String(value) }));
}

