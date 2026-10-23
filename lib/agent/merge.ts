// Merges rule-based candidates (the deterministic floor) with the model's validated hypotheses.
// Levels always come from computeEvidenceLevel/validateCitations; the model can add text, citations
// and contradictions, but can never lift a rule-backed level, and cannot assert time correlation.
// Honesty (H2): a rule-backed hypothesis keeps its rule title and explanation (model text may only be appended,
// labelled, after the certainty/claims filter); model citations are screened to cause-indicative observations
// (a "normal memory" fact contradicts RAM exhaustion, it never supports it); a model-only hypothesis left without an
// indicative support, or whose text is pure certainty/unsupported-action prose, is dropped.
import type { Hypothesis, UnknownItem } from "@/lib/contracts/hypothesis";
import { computeEvidenceLevel, levelRank, screenModelCitations, validateCitations, type Cause, type HypothesisDraft } from "@/lib/evidence/levels";
import type { RuleCandidate, RuleFindings } from "@/lib/evidence/hypotheses-rules";
import { TEMPORAL_SUMMARY } from "@/lib/evidence/temporal";
import { CPU_PATH_SUMMARY } from "@/lib/evidence/extract/metric";
import type { Observation } from "@/lib/evidence/types";
import type { Redactor } from "@/lib/security/redact";
import { filterModelProse } from "./claims-filter";
import { ANSWER_FA } from "./fa-messages";
import { toPlainText } from "./sanitize";
import type { ModelSynthesis } from "./synthesize";

export interface MergedMeta {
  cause?: Cause;
  candidate?: RuleCandidate;
  origin: "rule" | "model" | "both";
}
export interface MergedFindings {
  hypotheses: Hypothesis[];
  meta: Map<string, MergedMeta>;
  modelUnknowns: UnknownItem[];
  droppedModelHypotheses: number;
  droppedCitations: number;
}

interface Entry {
  draft: HypothesisDraft & { cause?: Cause };
  meta: MergedMeta;
  modelRank: number;
  ruleRank: number;
  cap?: RuleCandidate["evidence"]["level"];
}

const MAX_HYPOTHESES = 10;
export const NO_ACTION_CAUSES: ReadonlySet<Cause> = new Set<Cause>(["build_failure", "crash_after_release"]);
const uniq = (ids: readonly string[]) => [...new Set(ids)];

export function mergeFindings(rule: RuleFindings, model: ModelSynthesis | null, observations: readonly Observation[], redactor: Redactor): MergedFindings {
  const byId = new Map(observations.map((o) => [o.id, o]));
  // Correlation with a change is a rule-engine judgement: model-added temporal citations are ignored.
  const modelIds = (ids: readonly string[]) => ids.filter((id) => ![TEMPORAL_SUMMARY, CPU_PATH_SUMMARY].includes(byId.get(id)?.summary ?? ""));

  const entries: Entry[] = rule.candidates.map((c, i) => ({
    draft: {
      titleFa: c.titleFa,
      explanationFa: c.explanationFa,
      supports: c.supports,
      contradicts: c.contradicts,
      cause: c.cause,
      // Code/build bugs get a developer note, never an action hint (no button invites a futile action).
      ...(c.actionHint && !NO_ACTION_CAUSES.has(c.cause) ? { actionHint: c.actionHint } : {}),
    },
    meta: { cause: c.cause, candidate: c, origin: "rule" },
    modelRank: Number.POSITIVE_INFINITY,
    ruleRank: i,
    cap: c.evidence.level,
  }));

  let screenedOut = 0;
  (model?.hypotheses ?? []).forEach((m, j) => {
    const titleRaw = toPlainText(m.titleFa, 200, redactor);
    const explanationRaw = toPlainText(m.explanationFa, 1_200, redactor);
    const target = entries.find((e) => e.meta.origin === "rule" && e.meta.cause === m.cause);
    const screened = screenModelCitations(m.cause, modelIds(m.supports), m.contradicts, observations);
    if (target) {
      const supports = uniq([...target.draft.supports, ...screened.supports]);
      // Rule text stays; model prose is appended only after the claims filter, never replacing it.
      const extra = filterModelProse(explanationRaw, target.draft.actionHint ? [target.draft.actionHint] : []).text;
      const explanationFa = extra ? `${target.draft.explanationFa}\n${ANSWER_FA.modelExtra} ${extra}`.slice(0, 2_000) : target.draft.explanationFa;
      target.draft = {
        ...target.draft,
        explanationFa,
        supports,
        contradicts: uniq([...(target.draft.contradicts ?? []), ...screened.contradicts]).filter((id) => !supports.includes(id)),
      };
      target.meta = { ...target.meta, origin: "both" };
      target.modelRank = j;
      return;
    }
    // Model-only: no action is validated for it, so no action recommendation survives the filter.
    const titleFa = filterModelProse(titleRaw).text;
    const explanationFa = filterModelProse(explanationRaw).text;
    if (!titleFa || !explanationFa || screened.supports.length === 0) {
      screenedOut++;
      return;
    }
    // Model-only hypotheses keep no action hint: proposals need a rule-backed cause (see propose.ts).
    entries.push({
      draft: { titleFa, explanationFa, supports: screened.supports, contradicts: screened.contradicts, cause: m.cause },
      meta: { cause: m.cause, origin: "model" },
      modelRank: j,
      ruleRank: Number.POSITIVE_INFINITY,
    });
  });

  const scored = entries.map((e) => {
    const lvl = computeEvidenceLevel({ supports: e.draft.supports, contradicts: e.draft.contradicts, cause: e.draft.cause }, observations).level;
    const level = e.cap && levelRank(lvl) > levelRank(e.cap) ? e.cap : lvl;
    return { e, rank: levelRank(level) };
  });
  scored.sort((a, b) => b.rank - a.rank || a.e.modelRank - b.e.modelRank || a.e.ruleRank - b.e.ruleRank);
  const ordered = scored.slice(0, MAX_HYPOTHESES).map((s) => s.e);

  // Two passes: the first finds survivors, the second assigns contiguous ids H1..Hn in final order.
  const draftsOf = (list: Entry[]) => list.map((e, i) => ({ ...e.draft, id: `H${i + 1}`, ...(e.cap ? { level: e.cap } : {}) }));
  const first = validateCitations(draftsOf(ordered), observations);
  const keptIds = new Set(first.hypotheses.map((h) => h.id));
  const survivors = ordered.filter((_, i) => keptIds.has(`H${i + 1}`));
  const final = validateCitations(draftsOf(survivors), observations);

  const meta = new Map<string, MergedMeta>();
  final.hypotheses.forEach((h) => {
    const idx = Number(h.id.slice(1)) - 1;
    if (survivors[idx]) meta.set(h.id, survivors[idx].meta);
  });
  const modelUnknowns: UnknownItem[] = (model?.unknownsFa ?? [])
    .map((u) => filterModelProse(toPlainText(u, 500, redactor)).text)
    .filter(Boolean)
    .map((descriptionFa) => ({ descriptionFa }));
  const droppedModelHypotheses = first.droppedHypotheses.filter((d) => {
    const idx = Number(d.hypothesis.slice(1)) - 1;
    return ordered[idx]?.meta.origin === "model";
  }).length;
  return { hypotheses: final.hypotheses, meta, modelUnknowns, droppedModelHypotheses: droppedModelHypotheses + screenedOut, droppedCitations: first.droppedCitations.length };
}
