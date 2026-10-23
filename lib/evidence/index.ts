// Evidence engine public API. `collect*` do IO (server-only); everything else is pure and deterministic.
export { collectAppEvidence, collectDbEvidence, errorCode, type CollectAppOptions, type CollectDbOptions } from "./collect";
export { analyzeApp, analyzeDb, DEFAULT_WINDOW_MIN, type AppReads, type DbReads } from "./analyze";
export { EXTRACTORS, runExtractors } from "./extract";
export {
  CAUSES,
  SIGNATURE_KINDS,
  computeEvidenceLevel,
  validateCitations,
  levelRank,
  type Cause,
  type HypothesisLevelInput,
  type EvidenceLevelResult,
  type HypothesisDraft,
  type CitationValidation,
} from "./levels";
export { buildRuleFindings, type RuleCandidate, type RuleFindings, type RuleInput } from "./hypotheses-rules";
export { collectChanges, correlate, detectOnset, temporalObservations, buildTimeline, TEMPORAL_SUMMARY, CORRELATION_WINDOW_SEC } from "./temporal";
export { assignIds } from "./observe";
export { markSuspicious } from "./injection";
export { buildRedactor, redactBundle, redactObservation } from "./redact-bundle";
export type * from "./types";
