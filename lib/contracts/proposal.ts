import { z } from "zod";
import {
  AccountIdSchema,
  CodeSchema,
  CostSchema,
  IsoDateTimeSchema,
  SafeIdSchema,
  SafeKeySchema,
  Sha256HexSchema,
  TargetSchema,
} from "./common";
import { ACTION_POLICY, ActionParamsSchema, ActionTypeSchema, ReversibilitySchema, actionTarget } from "./action";
import { FindingSchema } from "./hypothesis";
import { ObservationIdSchema } from "./observation";

export { DeployPlanSchema, DeployPlanStepSchema, type DeployPlan, type DeployPlanStep } from "./deploy-plan";

/* -------------------------------------------------------------- proposal */

export const PROPOSAL_STATUSES = [
  "proposed",
  "approved",
  "executing",
  "verifying",
  "verified",
  "not_verified",
  "failed",
  "rejected",
  "expired",
  "stale",
] as const;
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const TERMINAL_PROPOSAL_STATUSES: readonly ProposalStatus[] = Object.freeze([
  "verified",
  "not_verified",
  "failed",
  "rejected",
  "expired",
  "stale",
]);

export const PROPOSAL_SOURCES = ["agent", "user", "setup"] as const;
export const ProposalSourceSchema = z.enum(PROPOSAL_SOURCES);
export type ProposalSource = z.infer<typeof ProposalSourceSchema>;

/** Default proposal lifetime (plan §5) and the hard cap a proposal may ever have. */
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;
export const PROPOSAL_MAX_TTL_MS = 60 * 60 * 1000;

export const ProposalHistoryEntrySchema = z.strictObject({ status: ProposalStatusSchema, at: IsoDateTimeSchema });

export const ProposalBaseSchema = z.strictObject({
  id: SafeIdSchema,
  status: ProposalStatusSchema,
  type: ActionTypeSchema,
  target: TargetSchema,
  params: ActionParamsSchema,
  rationaleFa: z.string().min(1).max(2000),
  evidenceIds: z.array(ObservationIdSchema).max(30),
  effectFa: z.string().min(1).max(1000),
  risksFa: z.array(z.string().min(1).max(500)).max(10),
  reversible: ReversibilitySchema,
  costEstimate: CostSchema.optional(),
  verificationPlan: z.array(z.string().min(1).max(300)).min(1).max(10),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
  source: ProposalSourceSchema,
  /** hashParams(params): binds approval tokens to these exact params. */
  paramsHash: Sha256HexSchema,
  idempotencyKey: SafeIdSchema,
  /** Hash of the relevant Liara state when proposed; a mismatch at confirm time => stale. */
  stateFingerprint: Sha256HexSchema,
  history: z.array(ProposalHistoryEntrySchema).max(20).optional(),
});

function sameTarget(a: { kind: string; name: string }, b: { kind: string; name: string }): boolean {
  return a.kind === b.kind && a.name === b.name;
}

/**
 * Cross-field invariants (cannot be bypassed by whoever builds the object):
 * - params.type === type, target is derived from params, reversibility comes from policy;
 * - source 'agent' only for aiProposable types and only with cited evidence;
 * - source 'setup' only for deploy_plan;
 * - billed actions carry a cost estimate;
 * - createdAt < expiresAt <= createdAt + PROPOSAL_MAX_TTL_MS.
 * paramsHash itself needs node:crypto and is checked by lib/security (assertProposalIntegrity).
 */
export const ProposalSchema = ProposalBaseSchema.superRefine((p, ctx) => {
  const policy = Object.prototype.hasOwnProperty.call(ACTION_POLICY, p.type) ? ACTION_POLICY[p.type] : undefined;
  if (policy === undefined) {
    ctx.addIssue({ code: "custom", message: "unknown action type", path: ["type"] });
    return;
  }
  if (p.params.type !== p.type) {
    ctx.addIssue({ code: "custom", message: "params.type must equal type", path: ["params"] });
  } else if (!sameTarget(p.target, actionTarget(p.params))) {
    ctx.addIssue({ code: "custom", message: "target must be derived from params", path: ["target"] });
  }
  if (p.reversible !== policy.reversible) {
    ctx.addIssue({ code: "custom", message: "reversible must come from ACTION_POLICY", path: ["reversible"] });
  }
  if (p.source === "agent") {
    if (!policy.aiProposable) {
      ctx.addIssue({ code: "custom", message: "the assistant may not propose this action", path: ["type"] });
    }
    if (p.evidenceIds.length === 0) {
      ctx.addIssue({ code: "custom", message: "assistant proposals must cite evidence", path: ["evidenceIds"] });
    }
  }
  if (p.source === "setup" && p.type !== "deploy_plan") {
    ctx.addIssue({ code: "custom", message: "setup proposals must be deploy_plan", path: ["type"] });
  }
  if (policy.billed && p.costEstimate === undefined) {
    ctx.addIssue({ code: "custom", message: "billed actions need a cost estimate", path: ["costEstimate"] });
  }
  if (new Set(p.evidenceIds).size !== p.evidenceIds.length) {
    ctx.addIssue({ code: "custom", message: "duplicate evidence id", path: ["evidenceIds"] });
  }
  const created = Date.parse(p.createdAt);
  const expires = Date.parse(p.expiresAt);
  if (!(expires > created) || expires - created > PROPOSAL_MAX_TTL_MS) {
    ctx.addIssue({ code: "custom", message: "expiresAt must be after createdAt and within the max TTL", path: ["expiresAt"] });
  }
});
export type Proposal = z.infer<typeof ProposalSchema>;

/* ---------------------------------------------------------- verification */

/**
 * passed   the observation confirms the intended state;
 * failed   the observation contradicts it;
 * unknown  the observation could not be made (unreadable, empty log window, nothing to compare);
 * skipped  deliberately not performed (e.g. non-web app: no HTTP probe). Never green, never evidence.
 */
export const VERIFICATION_CHECK_STATUSES = ["passed", "failed", "unknown", "skipped"] as const;
export const VerificationCheckStatusSchema = z.enum(VERIFICATION_CHECK_STATUSES);
export type VerificationCheckStatus = z.infer<typeof VerificationCheckStatusSchema>;

/**
 * `status` is optional for backward compatibility (older stored verifications only carry `passed`).
 * Invariant: `passed: true` iff the status is 'passed' (absent status => derived from `passed`).
 */
export const VerificationCheckSchema = z
  .strictObject({
    name: CodeSchema,
    passed: z.boolean(),
    status: VerificationCheckStatusSchema.optional(),
    detail: z.string().max(500),
  })
  .refine((c) => c.status === undefined || c.passed === (c.status === "passed"), {
    message: "passed must be true exactly when status is 'passed'",
    path: ["passed"],
  });
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

/** The effective status of a check (legacy checks without `status` derive it from `passed`). */
export function checkStatus(c: { passed: unknown; status?: unknown }): VerificationCheckStatus {
  if (c.status === "passed" || c.status === "failed" || c.status === "unknown" || c.status === "skipped") {
    return c.status === "passed" && c.passed !== true ? "failed" : c.status;
  }
  return c.passed === true ? "passed" : "failed";
}

/** Before/after snapshot of a few observable facts (status, probe code, error count...). */
export const SnapshotSchema = z
  .record(SafeKeySchema, z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .refine((r) => Object.keys(r).length <= 30, { message: "too many snapshot fields" });
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const VERIFICATION_OUTCOMES = ["verified", "not_verified", "failed"] as const;
export const VerificationOutcomeSchema = z.enum(VERIFICATION_OUTCOMES);
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

/**
 * "Fixed" is never inferred from API acceptance: `verified` requires at least one passed
 * check and no failed one (unknown/skipped checks may only be non-required ones; the server
 * applies the per-action rule in lib/actions/verify.ts); `not_verified` must name at least
 * one check that did not pass (failed, unknown or skipped).
 */
export const VerificationSchema = z
  .strictObject({
    checks: z.array(VerificationCheckSchema).max(20),
    outcome: VerificationOutcomeSchema,
    before: SnapshotSchema.optional(),
    after: SnapshotSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === "verified" && (!v.checks.some((c) => checkStatus(c) === "passed") || v.checks.some((c) => checkStatus(c) === "failed"))) {
      ctx.addIssue({ code: "custom", message: "verified requires a passed check and no failed one", path: ["outcome"] });
    }
    if (v.outcome === "not_verified" && !v.checks.some((c) => !c.passed)) {
      ctx.addIssue({ code: "custom", message: "not_verified must name a failed check", path: ["outcome"] });
    }
  });
export type Verification = z.infer<typeof VerificationSchema>;

/* -------------------------------------------------------------- incident */

export const INCIDENT_TIMELINE_KINDS = [
  "detected",
  "investigated",
  "observation",
  "finding",
  "proposed",
  "approved",
  "rejected",
  "executing",
  "executed",
  "verified",
  "not_verified",
  "failed",
  "expired",
  "stale",
  "resolved",
  "note",
] as const;
export const IncidentTimelineEntrySchema = z.strictObject({
  ts: IsoDateTimeSchema,
  kind: z.enum(INCIDENT_TIMELINE_KINDS),
  /** Proposal / observation / step id this entry refers to. */
  refId: SafeIdSchema.optional(),
  textFa: z.string().min(1).max(500).optional(),
});
export type IncidentTimelineEntry = z.infer<typeof IncidentTimelineEntrySchema>;

export const IncidentSchema = z
  .strictObject({
    id: SafeIdSchema,
    accountId: AccountIdSchema,
    target: TargetSchema,
    startedAt: IsoDateTimeSchema,
    resolvedAt: IsoDateTimeSchema.optional(),
    finding: FindingSchema,
    proposalId: SafeIdSchema.optional(),
    verification: VerificationSchema.optional(),
    timeline: z.array(IncidentTimelineEntrySchema).max(200),
    summaryMarkdown: z.string().max(20_000).optional(),
  })
  .superRefine((i, ctx) => {
    if (i.resolvedAt !== undefined && Date.parse(i.resolvedAt) < Date.parse(i.startedAt)) {
      ctx.addIssue({ code: "custom", message: "resolvedAt before startedAt", path: ["resolvedAt"] });
    }
  });
export type Incident = z.infer<typeof IncidentSchema>;
