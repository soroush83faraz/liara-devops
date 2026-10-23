import { z } from "zod";
import { CodeSchema } from "./common";
import { ActionTypeSchema } from "./action";
import { ObservationIdSchema, ObservationRefSchema } from "./observation";

/**
 * Hypotheses and findings. Evidence levels are computed by rules, never by the
 * model: the schema rejects a level that does not follow from `levelReason` and
 * the cited observations, so a model-invented "strong" cannot pass validation.
 */

export const EVIDENCE_LEVELS = ["strong", "medium", "weak", "insufficient"] as const;
export const EvidenceLevelSchema = z.enum(EVIDENCE_LEVELS);
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;

export interface EvidenceLevelInput {
  /** A signature observation for this cause was seen (e.g. "missing env X"). */
  signature: boolean;
  /** Onset within 5 min of a release/config change. */
  correlation: boolean;
  /** At least one contradicting observation. */
  contradicted: boolean;
  /** At least one supporting observation is cited. */
  supported: boolean;
}

/**
 * Plan §4 rules: strong = signature AND correlation AND not contradicted;
 * medium = exactly one of signature/correlation; weak = indirect support only;
 * a contradiction lowers one level; nothing cited = insufficient.
 */
export function deriveEvidenceLevel(r: EvidenceLevelInput): EvidenceLevel {
  if (!r.supported) return "insufficient";
  const base = r.signature && r.correlation ? 2 : r.signature || r.correlation ? 1 : 0;
  const level = r.contradicted ? base - 1 : base;
  return level >= 2 ? "strong" : level === 1 ? "medium" : level === 0 ? "weak" : "insufficient";
}

export const HypothesisIdSchema = z.string().regex(/^H[1-9][0-9]{0,2}$/);

const ObservationIdListSchema = z
  .array(ObservationIdSchema)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, { message: "duplicate observation id" });

export const LevelReasonSchema = z.strictObject({
  rule: CodeSchema,
  signature: z.boolean(),
  correlation: z.boolean(),
  contradicted: z.boolean(),
});
export type LevelReason = z.infer<typeof LevelReasonSchema>;

export const HypothesisSchema = z
  .strictObject({
    id: HypothesisIdSchema,
    titleFa: z.string().min(1).max(200),
    explanationFa: z.string().min(1).max(2000),
    supports: ObservationIdListSchema,
    contradicts: ObservationIdListSchema,
    level: EvidenceLevelSchema,
    levelReason: LevelReasonSchema,
    actionHint: ActionTypeSchema.optional(),
  })
  .superRefine((h, ctx) => {
    if (h.supports.some((id) => h.contradicts.includes(id))) {
      ctx.addIssue({ code: "custom", message: "an observation cannot both support and contradict", path: ["contradicts"] });
    }
    if (h.levelReason.contradicted !== h.contradicts.length > 0) {
      ctx.addIssue({ code: "custom", message: "levelReason.contradicted must match contradicts", path: ["levelReason"] });
    }
    if (h.supports.length === 0 && (h.levelReason.signature || h.levelReason.correlation)) {
      ctx.addIssue({ code: "custom", message: "signature/correlation require a cited observation", path: ["levelReason"] });
    }
    const expected = deriveEvidenceLevel({ ...h.levelReason, supported: h.supports.length > 0 });
    if (h.level !== expected) {
      ctx.addIssue({ code: "custom", message: `level must be ${expected} for this levelReason`, path: ["level"] });
    }
  });
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const RuledOutSchema = z.strictObject({
  titleFa: z.string().min(1).max(200),
  reasonFa: z.string().min(1).max(1000),
  observationIds: ObservationIdListSchema,
});
export type RuledOut = z.infer<typeof RuledOutSchema>;

export const UnknownItemSchema = z.strictObject({
  descriptionFa: z.string().min(1).max(500),
  howToGet: z.string().min(1).max(500).optional(),
});
export type UnknownItem = z.infer<typeof UnknownItemSchema>;

export const FindingSchema = z
  .strictObject({
    facts: z.array(ObservationRefSchema).max(100),
    hypotheses: z.array(HypothesisSchema).max(10),
    ruledOut: z.array(RuledOutSchema).max(10),
    unknowns: z.array(UnknownItemSchema).max(10),
    limitsNote: z.array(z.string().min(1).max(500)).max(10).optional(),
  })
  .superRefine((f, ctx) => {
    // Citation integrity: every cited id must be one of this finding's facts.
    const factIds = new Set<string>();
    f.facts.forEach((o, i) => {
      if (factIds.has(o.id)) ctx.addIssue({ code: "custom", message: "duplicate fact id", path: ["facts", i] });
      factIds.add(o.id);
    });
    const hypothesisIds = new Set<string>();
    f.hypotheses.forEach((h, i) => {
      if (hypothesisIds.has(h.id)) ctx.addIssue({ code: "custom", message: "duplicate hypothesis id", path: ["hypotheses", i] });
      hypothesisIds.add(h.id);
      for (const id of [...h.supports, ...h.contradicts]) {
        if (!factIds.has(id)) ctx.addIssue({ code: "custom", message: `unknown observation ${id}`, path: ["hypotheses", i] });
      }
    });
    f.ruledOut.forEach((r, i) => {
      for (const id of r.observationIds) {
        if (!factIds.has(id)) ctx.addIssue({ code: "custom", message: `unknown observation ${id}`, path: ["ruledOut", i] });
      }
    });
  });
export type Finding = z.infer<typeof FindingSchema>;
