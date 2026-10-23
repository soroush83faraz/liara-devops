/**
 * Shared contracts (zod schemas + inferred types). Isomorphic: safe to import
 * from client components. Server-only security helpers live in lib/security.
 * Synthetic sample data lives in ./fixtures (import it explicitly; not re-exported).
 */
export * from "./common";
export * from "./env";
export * from "./deploy-plan";
export * from "./action";
export * from "./observation";
export * from "./hypothesis";
export {
  PROPOSAL_STATUSES,
  ProposalStatusSchema,
  type ProposalStatus,
  TERMINAL_PROPOSAL_STATUSES,
  PROPOSAL_SOURCES,
  ProposalSourceSchema,
  type ProposalSource,
  PROPOSAL_TTL_MS,
  PROPOSAL_MAX_TTL_MS,
  ProposalHistoryEntrySchema,
  ProposalBaseSchema,
  ProposalSchema,
  type Proposal,
  VerificationCheckSchema,
  type VerificationCheck,
  VERIFICATION_CHECK_STATUSES,
  VerificationCheckStatusSchema,
  type VerificationCheckStatus,
  checkStatus,
  SnapshotSchema,
  type Snapshot,
  VERIFICATION_OUTCOMES,
  VerificationOutcomeSchema,
  type VerificationOutcome,
  VerificationSchema,
  type Verification,
  INCIDENT_TIMELINE_KINDS,
  IncidentTimelineEntrySchema,
  type IncidentTimelineEntry,
  IncidentSchema,
  type Incident,
} from "./proposal";
export * from "./audit";
export * from "./layout";
export * from "./stream";
