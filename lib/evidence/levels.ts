// Evidence levels (plan §4) and citation validation. Pure; levels never come from a model.
import {
  deriveEvidenceLevel,
  EVIDENCE_LEVELS,
  HypothesisSchema,
  type EvidenceLevel,
  type Hypothesis,
  type LevelReason,
} from "@/lib/contracts/hypothesis";
import { ACTION_POLICY, isActionType, type ActionType } from "@/lib/contracts/action";
import { isSignature, paramNum } from "./observe";
import { TEMPORAL_SUMMARY } from "./temporal";
import { CPU_PATH_SUMMARY } from "./extract/metric";
import type { Observation, ObservationKind } from "./types";

/** Failure classes of the rule engine (also usable by the agent to scope signatures). */
export const CAUSES = [
  "missing_env",
  "wrong_port",
  "crash_after_release",
  "build_failure",
  "db_unreachable",
  "oom",
  "cpu_saturation",
  "external_dependency",
  "transient_unknown",
] as const;
export type Cause = (typeof CAUSES)[number];

/** Observation kinds that can be a *signature* of each cause (also needs params.sig = 1). */
export const SIGNATURE_KINDS: Readonly<Record<Cause, readonly ObservationKind[]>> = {
  missing_env: ["missing_env", "config"],
  wrong_port: ["port_mismatch"],
  crash_after_release: ["crash", "release_state"],
  build_failure: ["build_error", "release_state"],
  db_unreachable: ["connection_error", "db_state"],
  oom: ["oom"],
  cpu_saturation: ["metric"],
  external_dependency: ["connection_error"],
  transient_unknown: [],
};

/** Observation from a previous release's runtime output (kept as history, never diagnosis). */
export const isHistorical = (o: { params: Record<string, string | number> }): boolean => paramNum(o, "historical") === 1;

/* ------------------------------------------------ cause-appropriate support (H2) */

type ObsTest = (o: Observation) => boolean;
const sum = (re: RegExp): ObsTest => (o) => re.test(o.summary);
const kind = (...ks: ObservationKind[]): ObsTest => (o) => ks.includes(o.kind);
const any = (...ts: ObsTest[]): ObsTest => (o) => ts.some((t) => t(o));

/**
 * Which observations can actually INDICATE each cause. Symptoms shared by every cause (5xx, slow probe, a READY
 * release, "listening on port N") are not indicative of any one of them. Applied to model-cited supports: a model
 * cannot make a fact support a cause it says nothing about.
 */
export const INDICATIVE: Readonly<Record<Cause, ObsTest>> = {
  missing_env: any(kind("missing_env"), sum(/^evidence\.config\.(?:key_absent|default_used)$/)),
  wrong_port: any(kind("port_mismatch"), sum(/^evidence\.port\.(?!.*matches)/)),
  crash_after_release: any(kind("crash"), sum(/^evidence\.release\.(?:unhealthy|newest_not_serving)$|^evidence\.applet\.(?:not_running|unhealthy)$|^evidence\.temporal\./)),
  build_failure: any(kind("build_error"), sum(/^evidence\.build\.|^evidence\.release\.(?:failed|canceled|newest_not_serving)/)),
  db_unreachable: any(kind("connection_error"), sum(/^evidence\.db\.(?:not_running|stopped|network_differs|public_off_but_used)$/)),
  oom: any(kind("oom"), sum(/^evidence\.metric\.memory_(?:high|near_limit|growing)$|^evidence\.event\.oom/)),
  cpu_saturation: sum(/^evidence\.metric\.cpu_(?:high|sustained_high)$/),
  external_dependency: kind("connection_error"),
  transient_unknown: () => false,
};

/** Observations that speak AGAINST a cause: cited as support by a model, they become contradictions. */
export const CONTRADICTING: Readonly<Partial<Record<Cause, ObsTest>>> = {
  oom: sum(/^evidence\.metric\.memory_normal$/),
  cpu_saturation: sum(/^evidence\.metric\.cpu_normal$/),
  wrong_port: sum(/^evidence\.config\.port_matches$/),
  db_unreachable: sum(/^evidence\.db\.running$/),
  missing_env: sum(/^evidence\.config\.key_present$/),
};

export interface ScreenedCitations {
  supports: string[];
  contradicts: string[];
  /** Supports that cannot indicate the cause (dropped). */
  nonIndicative: string[];
  /** Supports moved to contradicts. */
  reversed: string[];
}

/**
 * Screens MODEL-cited ids for a cause: indicative ones stay supports, contradicting ones move to `contradicts`,
 * everything else is dropped. Unknown ids pass through (validateCitations reports them).
 */
export function screenModelCitations(cause: Cause, supports: readonly string[], contradicts: readonly string[], observations: readonly Observation[]): ScreenedCitations {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const out: ScreenedCitations = { supports: [], contradicts: [...contradicts], nonIndicative: [], reversed: [] };
  for (const id of supports) {
    const o = byId.get(id);
    if (!o) out.supports.push(id);
    // A fact from a release that no longer serves cannot indicate anything about the present state.
    else if (isHistorical(o)) out.nonIndicative.push(id);
    else if (CONTRADICTING[cause]?.(o)) {
      out.reversed.push(id);
      if (!out.contradicts.includes(id)) out.contradicts.push(id);
    } else if (INDICATIVE[cause](o)) out.supports.push(id);
    else out.nonIndicative.push(id);
  }
  return out;
}

export interface HypothesisLevelInput {
  supports: readonly string[];
  contradicts?: readonly string[];
  /** Restricts which observation kinds count as a signature. Without it any `sig` observation counts. */
  cause?: Cause;
  /** Explicit correlation (rule engine). Model-provided hypotheses must not pass this. */
  correlation?: { within5min: boolean } | null;
}

export interface EvidenceLevelResult extends LevelReason {
  level: EvidenceLevel;
  reasonCodes: string[];
  /** Known, unflagged supports in input order. */
  usableSupports: string[];
  /** Known, unflagged contradictions that are not also supports. */
  validContradicts: string[];
}

/**
 * Correlation: an onset within 5 min of a release/config change. For `cpu_saturation` only, also the access-log
 * observation that the slow requests of one path started together with the CPU pressure (built by the metric extractor;
 * a model can never cite it as support, see INDICATIVE and merge.ts).
 */
const isCorrelationObs = (o: Observation, cause?: Cause) =>
  !o.flagged &&
  ((o.summary === TEMPORAL_SUMMARY && paramNum(o, "within5min") === 1) || (cause === "cpu_saturation" && o.summary === CPU_PATH_SUMMARY && paramNum(o, "correlated") === 1));

/**
 * Plan §4, exactly:
 *  strong = signature AND onset within 5 min of a release/config change AND no contradiction;
 *  medium = exactly one of signature/correlation; weak = indirect support only;
 *  insufficient = no usable observation; a contradiction lowers the level by one and is listed.
 * Delegates the arithmetic to the contract's `deriveEvidenceLevel` so schema validation always agrees.
 */
export function computeEvidenceLevel(h: HypothesisLevelInput, observations: readonly Observation[]): EvidenceLevelResult {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const reasonCodes: string[] = [];
  const uniq = (ids: readonly string[]) => [...new Set(ids)];

  const usable: Observation[] = [];
  for (const id of uniq(h.supports)) {
    const o = byId.get(id);
    if (!o) reasonCodes.push(`unknown_support:${id}`);
    else if (o.flagged) reasonCodes.push(`flagged_support_ignored:${id}`);
    else usable.push(o);
  }
  const usableIds = new Set(usable.map((o) => o.id));
  const validContradicts = uniq(h.contradicts ?? []).filter((id) => {
    const o = byId.get(id);
    if (!o) reasonCodes.push(`unknown_contradiction:${id}`);
    else if (o.flagged) reasonCodes.push(`flagged_contradiction_ignored:${id}`);
    return Boolean(o && !o.flagged && !usableIds.has(id));
  });

  const kinds = h.cause ? SIGNATURE_KINDS[h.cause] : undefined;
  const signature = usable.some((o) => isSignature(o) && (!kinds || kinds.includes(o.kind)));
  const correlation = h.correlation ? h.correlation.within5min : usable.some((o) => isCorrelationObs(o, h.cause));
  const contradicted = validContradicts.length > 0;
  const supported = usable.length > 0;
  const level = deriveEvidenceLevel({ supported, signature: supported && signature, correlation: supported && correlation, contradicted });

  const parts = !supported ? "no_usable_support" : signature && correlation ? "signature_and_correlation" : signature ? "signature_only" : correlation ? "correlation_only" : "indirect_only";
  const rule = `level.${level}.${parts}${contradicted && supported ? ".contradicted" : ""}`;
  if (signature && supported) reasonCodes.push("signature");
  if (correlation && supported) reasonCodes.push("correlation_within_5min");
  if (contradicted) reasonCodes.push(...validContradicts.map((id) => `contradicted_by:${id}`));
  return {
    level,
    rule,
    signature: supported && signature,
    correlation: supported && correlation,
    contradicted,
    reasonCodes,
    usableSupports: usable.map((o) => o.id),
    validContradicts,
  };
}

export const levelRank = (l: EvidenceLevel): number => EVIDENCE_LEVELS.length - 1 - EVIDENCE_LEVELS.indexOf(l);

/* ------------------------------------------------------------ citations */

/** Hypothesis as produced by a model or the rule engine before validation. */
export interface HypothesisDraft {
  id?: string;
  titleFa: string;
  explanationFa: string;
  supports: readonly string[];
  contradicts?: readonly string[];
  /** Level claimed upstream; validation may lower it, never raise it. */
  level?: EvidenceLevel;
  actionHint?: string;
  cause?: Cause;
}

export interface DroppedCitation {
  hypothesis: string;
  observationId: string;
  reason: "unknown_id" | "flagged" | "duplicate" | "also_supports";
  role: "supports" | "contradicts";
}
export interface DroppedHypothesis {
  hypothesis: string;
  reason: "no_valid_supports" | "invalid_text" | "schema" | "claimed_insufficient";
}
export interface CitationValidation {
  hypotheses: Hypothesis[];
  droppedCitations: DroppedCitation[];
  droppedHypotheses: DroppedHypothesis[];
  droppedActionHints: Array<{ hypothesis: string; actionHint: string }>;
}

const HYP_ID = /^H[1-9][0-9]{0,2}$/;

/** Lowers signature/correlation flags until the derived level is <= `cap` (never invents evidence). */
function clampReason(r: LevelReason, cap: EvidenceLevel): { reason: LevelReason; level: EvidenceLevel } {
  const reason: LevelReason = { ...r, rule: `${r.rule}.clamped` };
  const lvl = () => deriveEvidenceLevel({ ...reason, supported: true });
  if (levelRank(lvl()) > levelRank(cap)) reason.correlation = false;
  if (levelRank(lvl()) > levelRank(cap)) reason.signature = false;
  return { reason, level: lvl() };
}

/**
 * Drops unknown/flagged citation ids, drops hypotheses left without a valid support, recomputes levels
 * from the surviving citations and never raises a level above the claimed one. Strips action hints that
 * are not assistant-proposable ActionTypes. Returns schema-valid hypotheses plus everything dropped.
 */
export function validateCitations(drafts: readonly HypothesisDraft[], observations: readonly Observation[]): CitationValidation {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const res: CitationValidation = { hypotheses: [], droppedCitations: [], droppedHypotheses: [], droppedActionHints: [] };
  const usedIds = new Set<string>();
  let next = 1;

  drafts.forEach((d, idx) => {
    const name = d.id ?? `#${idx + 1}`;
    const keep = (ids: readonly string[] | undefined, role: DroppedCitation["role"], exclude: Set<string>): string[] => {
      const out: string[] = [];
      for (const id of ids ?? []) {
        const o = byId.get(id);
        const reason: DroppedCitation["reason"] | undefined = !o ? "unknown_id" : o.flagged ? "flagged" : out.includes(id) ? "duplicate" : exclude.has(id) ? "also_supports" : undefined;
        if (reason) res.droppedCitations.push({ hypothesis: name, observationId: id, reason, role });
        else out.push(id);
      }
      return out;
    };
    const supports = keep(d.supports, "supports", new Set());
    const contradicts = keep(d.contradicts, "contradicts", new Set(supports));
    if (supports.length === 0) {
      res.droppedHypotheses.push({ hypothesis: name, reason: "no_valid_supports" });
      return;
    }
    const titleFa = d.titleFa?.trim().slice(0, 200) ?? "";
    const explanationFa = d.explanationFa?.trim().slice(0, 2000) ?? "";
    if (!titleFa || !explanationFa) {
      res.droppedHypotheses.push({ hypothesis: name, reason: "invalid_text" });
      return;
    }

    const computed = computeEvidenceLevel({ supports, contradicts, cause: d.cause }, observations);
    let reason: LevelReason = { rule: computed.rule, signature: computed.signature, correlation: computed.correlation, contradicted: computed.contradicted };
    let level = computed.level;
    if (d.level && levelRank(level) > levelRank(d.level)) ({ reason, level } = clampReason(reason, d.level));
    if (d.level && levelRank(level) > levelRank(d.level)) {
      // Claimed "insufficient" while citing valid evidence: no schema-valid level is that low.
      res.droppedHypotheses.push({ hypothesis: name, reason: "claimed_insufficient" });
      return;
    }

    let actionHint: ActionType | undefined;
    if (d.actionHint !== undefined) {
      if (isActionType(d.actionHint) && ACTION_POLICY[d.actionHint].aiProposable) actionHint = d.actionHint;
      else res.droppedActionHints.push({ hypothesis: name, actionHint: String(d.actionHint).slice(0, 40) });
    }

    let id = d.id && HYP_ID.test(d.id) && !usedIds.has(d.id) ? d.id : undefined;
    while (!id) {
      const candidate = `H${next++}`;
      if (!usedIds.has(candidate) && !drafts.some((x) => x.id === candidate)) id = candidate;
    }
    usedIds.add(id);
    const h = { id, titleFa, explanationFa, supports, contradicts, level, levelReason: reason, ...(actionHint ? { actionHint } : {}) };
    const parsed = HypothesisSchema.safeParse(h);
    if (parsed.success) res.hypotheses.push(parsed.data);
    else res.droppedHypotheses.push({ hypothesis: name, reason: "schema" });
  });
  return res;
}
