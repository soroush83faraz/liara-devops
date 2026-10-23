// The plain-text answer is assembled by code from the validated finding (three labels: observed /
// inferred / unknown). The HEADLINE is built by code from the validated top finding (level + title), never from
// model prose. The model's summary appears only in a labelled «خلاصه‌ی مدل (برداشت)» block AFTER the code-built
// sections, and only after the certainty/claims filter (lib/agent/claims-filter.ts).
import type { Finding, Hypothesis } from "@/lib/contracts/hypothesis";
import type { Proposal } from "@/lib/contracts/proposal";
import type { Observation } from "@/lib/evidence/types";
import { filterModelProse } from "./claims-filter";
import { ANSWER_FA, LEVEL_FA } from "./fa-messages";

export interface AnswerInput {
  finding: Finding;
  /** Override; by default the headline is built from the finding by `codeHeadline`. */
  headline?: string;
  /** Raw (already plain-text, redacted) model summary; filtered and labelled here. */
  modelSummary?: string;
  /** Every evidence source failed: nothing can be said about health or cause. */
  allSourcesFailed?: boolean;
  proposal?: Proposal;
  /** Extra notes in display order (restart won't help, better action, partial evidence...). */
  notes: string[];
  developer?: Hypothesis;
}

const MAX_OBSERVED = 6;

/** Placeholder fill with a function replacer, so `$&`-style sequences in values are inert. */
export const tpl = (t: string, p: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m));
const EXCERPT = 140;

function observedLines(f: Finding): string[] {
  const cited = new Set(f.hypotheses.flatMap((h) => h.supports));
  const pick = (o: Observation) => !o.flagged && (cited.size === 0 ? o.severity !== "info" : cited.has(o.id));
  return f.facts
    .filter(pick)
    .slice(0, MAX_OBSERVED)
    .map((o) => {
      const text = o.text.replace(/\s+/g, " ").trim();
      return `- [${o.id}]${o.ts ? ` ${o.ts}` : ""} ${text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text || o.summary}`;
    });
}

/** Headline from validated data only: all-failed > top hypothesis (title + level) > errors without cause > healthy. */
export function codeHeadline(f: Finding, allSourcesFailed = false): string {
  if (allSourcesFailed) return ANSWER_FA.allFailedHeadline;
  const top = f.hypotheses[0];
  if (top) return tpl(ANSWER_FA.topHeadline, { title: top.titleFa, level: LEVEL_FA[top.level] });
  if (f.facts.some((o) => !o.flagged && (o.severity === "error" || o.severity === "warn"))) return ANSWER_FA.errorsNoCauseHeadline;
  return ANSWER_FA.healthyHeadline;
}

export function buildAnswer(a: AnswerInput): string {
  const f = a.finding;
  const out: string[] = [];
  out.push(a.headline ?? codeHeadline(f, a.allSourcesFailed), "");

  out.push(ANSWER_FA.observed);
  const obs = observedLines(f);
  out.push(...(obs.length ? obs : [`- ${a.allSourcesFailed ? ANSWER_FA.noFactsAllFailed : ANSWER_FA.noFacts}`]), "");

  out.push(ANSWER_FA.inferred);
  if (f.hypotheses.length === 0) out.push(`- ${ANSWER_FA.noHypothesis}`);
  for (const h of f.hypotheses.slice(0, 3)) {
    out.push(`- ${tpl(ANSWER_FA.hypothesisLine, { title: h.titleFa, level: LEVEL_FA[h.level], ids: h.supports.join(ANSWER_FA.idSeparator) })}`);
    out.push(`  ${h.explanationFa}`);
  }
  if (f.hypotheses.length) out.push(`  ${ANSWER_FA.hypothesisNote}`);
  out.push("");

  out.push(ANSWER_FA.unknown);
  const unknowns = f.unknowns.slice(0, 5).map((u) => `- ${u.descriptionFa}${u.howToGet ? ` (${u.howToGet})` : ""}`);
  out.push(...(unknowns.length ? unknowns : [`- ${ANSWER_FA.noUnknowns}`]));

  if (a.developer) out.push("", ANSWER_FA.developerTitle, `- ${a.developer.explanationFa}`, `- ${ANSWER_FA.developerRestart}`);
  if (a.notes.length) out.push("", ...a.notes);
  out.push("", a.proposal ? tpl(ANSWER_FA.proposal, { effect: a.proposal.effectFa }) : ANSWER_FA.noProposal);

  if (a.modelSummary) {
    const filtered = filterModelProse(a.modelSummary, a.proposal ? [a.proposal.type] : []);
    if (filtered.text || filtered.dropped) {
      out.push("", ANSWER_FA.modelSummaryTitle);
      if (filtered.text) out.push(filtered.text);
      out.push(`(${ANSWER_FA.modelSummaryNote}${filtered.dropped ? ` ${tpl(ANSWER_FA.modelFiltered, { count: filtered.dropped })}` : ""})`);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
