"use client";

import { CircleHelp, Eye, Info, Lightbulb, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { Finding, Hypothesis, Observation } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import { Disclosure } from "./disclosure";
import { EvidenceItem } from "./evidence-item";
import { EvidenceLevelChip, levelReasonLine, ruleLabel } from "./evidence-level-chip";
import { MockDataBadge } from "./mock-data-badge";
import { SafeMarkdown } from "./safe-markdown";

const l = fa.copilotUi.finding;

function Section({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
        <Icon aria-hidden className="size-4 text-accent" />
        {title}
        {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
      </h4>
      {children}
    </section>
  );
}

function CitedIds({ ids, facts, onOpen }: { ids: string[]; facts: Map<string, Observation>; onOpen: (o: Observation) => void }) {
  if (ids.length === 0) return <p className="text-xs text-muted">{l.noCitation}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const o = facts.get(id);
        return (
          <li key={id}>
            {o ? (
              <button
                type="button"
                onClick={() => onOpen(o)}
                className="min-h-11 rounded-full border border-border bg-surface px-3 text-xs hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-8"
                aria-label={fill(fa.copilotUi.evidence.open, { id })}
              >
                <bdi dir="ltr" className="font-mono">
                  {id}
                </bdi>
              </button>
            ) : (
              <bdi dir="ltr" className="font-mono text-xs">
                {id}
              </bdi>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function WhyPanel({ h, facts, onOpen }: { h: Hypothesis; facts: Map<string, Observation>; onOpen: (o: Observation) => void }) {
  const yn = (b: boolean) => (b ? l.reasonYes : l.reasonNo);
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-muted p-3 text-sm leading-7">
      <p>{l.whyIntro}</p>
      <ul className="flex flex-col gap-1">
        <li>
          {l.reasonSignature}: <strong>{yn(h.levelReason.signature)}</strong>
        </li>
        <li>
          {l.reasonCorrelation}: <strong>{yn(h.levelReason.correlation)}</strong>
        </li>
        <li>
          {l.reasonContradicted}: <strong>{yn(h.levelReason.contradicted)}</strong>
        </li>
        <li>
          {l.reasonRule}: <span>{ruleLabel(h.levelReason.rule) ?? ""}</span>{" "}
          <bdi dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono text-xs">
            {h.levelReason.rule}
          </bdi>
        </li>
      </ul>
      <div>
        <p className="mb-1 font-medium">{l.supports}</p>
        <CitedIds ids={h.supports} facts={facts} onOpen={onOpen} />
      </div>
      {h.contradicts.length > 0 ? (
        <div>
          <p className="mb-1 font-medium">{l.contradicts}</p>
          <CitedIds ids={h.contradicts} facts={facts} onOpen={onOpen} />
        </div>
      ) : null}
    </div>
  );
}

function HypothesisBlock({
  h,
  facts,
  onOpen,
  primary,
  degraded,
}: {
  h: Hypothesis;
  facts: Map<string, Observation>;
  onOpen: (o: Observation) => void;
  primary?: boolean;
  degraded?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {primary ? <span className="text-xs font-medium text-muted">{l.mainHypothesis}</span> : null}
        <EvidenceLevelChip level={h.level} reason={h.levelReason} />
      </div>
      <p className="text-[15px] font-semibold leading-8">{stripUnsafeChars(h.titleFa)}</p>
      {degraded && h.explanationFa === h.titleFa ? null : <SafeMarkdown text={h.explanationFa} className="text-muted" />}
      <div>
        <p className="mb-1 text-xs text-muted">{l.citedLabel}</p>
        <CitedIds ids={[...h.supports, ...h.contradicts]} facts={facts} onOpen={onOpen} />
      </div>
      <Disclosure summary={l.why}>
        <WhyPanel h={h} facts={facts} onOpen={onOpen} />
      </Disclosure>
      <p className="sr-only">{levelReasonLine(h.levelReason)}</p>
    </div>
  );
}

/**
 * The investigation result. Three labelled layers per the plan: what was OBSERVED (facts with sources), what we
 * INFER (hypotheses with a rule-computed evidence level), and what is UNKNOWN. Never presents a guess as fact.
 */
export function FindingCard({
  finding,
  incomplete = false,
  degraded = false,
  onOpenEvidence,
}: {
  finding: Finding;
  /** Some investigation step failed: say so next to the result. */
  incomplete?: boolean;
  degraded?: boolean;
  onOpenEvidence: (o: Observation) => void;
}) {
  const facts = new Map(finding.facts.map((o) => [o.id, o] as const));
  const [main, ...rest] = finding.hypotheses;
  const allInsufficient = finding.hypotheses.length > 0 && finding.hypotheses.every((h) => h.level === "insufficient");
  const noCause = finding.hypotheses.length === 0;
  const insufficient = allInsufficient || (noCause && finding.unknowns.length > 0);
  const healthy = noCause && !insufficient;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold leading-8">
          {l.title}
          <MockDataBadge />
        </h3>

        {incomplete ? (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
            <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
            <span>
              <strong>{l.partialTitle}.</strong> {l.partialBody}
            </span>
          </p>
        ) : null}

        {finding.facts.length > 0 ? (
          <Section icon={Eye} title={l.observed} hint={l.observedHint}>
            <ul className="flex flex-col gap-2">
              {finding.facts.map((o) => (
                <li key={o.id}>
                  <EvidenceItem observation={o} compact onOpen={onOpenEvidence} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section icon={Lightbulb} title={l.inferred} hint={l.inferredHint}>
          {insufficient ? (
            <div role="status" className="flex items-start gap-2 rounded-lg bg-surface-muted p-3 text-sm leading-7">
              <Info aria-hidden className="mt-1 size-4 shrink-0 text-accent" />
              <span>
                <strong>{l.insufficientTitle}.</strong> {l.insufficientBody}
              </span>
            </div>
          ) : null}
          {healthy ? (
            <div role="status" className="rounded-lg bg-ok-soft p-3 text-sm leading-7 text-ok-ink">
              <strong>{l.healthyTitle}.</strong> {l.healthyBody}
            </div>
          ) : null}
          {main ? <HypothesisBlock h={main} facts={facts} onOpen={onOpenEvidence} primary degraded={degraded} /> : null}
          {rest.length > 0 ? (
            <Disclosure summary={fill(l.otherHypotheses, { count: rest.length })}>
              <ul className="flex flex-col gap-4 ps-1">
                {rest.map((h) => (
                  <li key={h.id} className="border-s-2 border-border ps-3">
                    <HypothesisBlock h={h} facts={facts} onOpen={onOpenEvidence} degraded={degraded} />
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
          {finding.ruledOut.length > 0 ? (
            <Disclosure summary={l.ruledOut}>
              <ul className="flex flex-col gap-3">
                {finding.ruledOut.map((r, i) => (
                  <li key={i} className="flex flex-col gap-1 rounded-lg bg-surface-muted p-3 text-sm leading-7">
                    <span className="font-medium">{stripUnsafeChars(r.titleFa)}</span>
                    <span className="text-muted">{stripUnsafeChars(r.reasonFa)}</span>
                    {r.observationIds.length > 0 ? <CitedIds ids={r.observationIds} facts={facts} onOpen={onOpenEvidence} /> : null}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
        </Section>

        {finding.unknowns.length > 0 ? (
          <Section icon={CircleHelp} title={l.unknown} hint={l.unknownHint}>
            <ul className="flex flex-col gap-2">
              {finding.unknowns.map((u, i) => (
                <li key={i} className="rounded-lg border border-dashed border-border-strong/60 p-3 text-sm leading-7">
                  <p>{stripUnsafeChars(u.descriptionFa)}</p>
                  {u.howToGet ? <p className="text-muted">{fill(l.howToGet, { text: stripUnsafeChars(u.howToGet) })}</p> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {finding.limitsNote && finding.limitsNote.length > 0 ? (
          <aside aria-label={l.limits} className="flex items-start gap-2 rounded-lg bg-surface-muted p-3 text-sm leading-7 text-muted">
            <Info aria-hidden className="mt-1 size-4 shrink-0" />
            <div>
              <p className="font-medium text-foreground">{l.limits}</p>
              <ul className="list-disc ps-4">
                {finding.limitsNote.map((n, i) => (
                  <li key={i}>{stripUnsafeChars(n)}</li>
                ))}
              </ul>
            </div>
          </aside>
        ) : null}
      </CardContent>
    </Card>
  );
}
