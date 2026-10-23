"use client";

import { Badge } from "@/components/ui/badge";
import { KeyValueList } from "@/components/ui/key-value-list";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { Observation } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { faDateTime, isoUtc } from "@/lib/i18n/format";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import { FlaggedBadge, kindLabel, observationDetailRows, ReleaseBadge, sourceLabel } from "./evidence-item";
import { LtrBlock } from "./ltr-block";

const l = fa.copilotUi.evidence;

const SEVERITY_TONE = { info: "neutral", warn: "warn", error: "danger" } as const;

/** Side sheet (bottom sheet on phones) with everything we know about one observation. */
export function EvidenceDrawer({ observation, onClose }: { observation: Observation | null; onClose: () => void }) {
  return (
    <Sheet open={observation !== null} onOpenChange={(open) => !open && onClose()}>
      {observation ? (
        <SheetContent
          side="start"
          title={fill(l.drawerTitle, { id: observation.id })}
          description={l.drawerDescription}
        >
          <div className="flex flex-col gap-4 p-5">
            {observation.flagged ? (
              <div className="rounded-sm border border-danger/40 bg-danger-soft p-3 text-danger-ink">
                <FlaggedBadge withHint />
              </div>
            ) : null}
            <ReleaseBadge observation={observation} withHint />
            <KeyValueList
              items={[
                { key: l.type, value: kindLabel(observation) },
                {
                  key: l.severity,
                  value: <Badge tone={SEVERITY_TONE[observation.severity]}>{l.severityLabel[observation.severity]}</Badge>,
                },
                { key: l.source, value: sourceLabel(observation) },
                {
                  key: l.time,
                  value: observation.ts ? faDateTime(observation.ts) : l.noTime,
                },
                ...(observation.ts ? [{ key: "UTC", value: isoUtc(observation.ts), ltr: true, copy: isoUtc(observation.ts) }] : []),
                { key: l.code, value: observation.summary, ltr: true },
              ]}
            />
            <section aria-labelledby="ev-raw">
              <h3 id="ev-raw" className="mb-2 text-sm font-semibold">
                {l.rawText}
              </h3>
              <LtrBlock text={stripUnsafeChars(observation.text)} copy maxHeightClass="max-h-72" label={l.rawText} />
            </section>
            {Object.keys(observation.params).length > 0 ? (
              <section aria-labelledby="ev-params">
                <h3 id="ev-params" className="mb-1 text-sm font-semibold">
                  {l.params}
                </h3>
                <KeyValueList
                  items={observationDetailRows(observation).map((r) => ({ key: <bdi dir="ltr" className="font-mono text-xs">{r.key}</bdi>, value: r.value, ltr: true }))}
                />
              </section>
            ) : null}
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
