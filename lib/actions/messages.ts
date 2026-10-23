// User-facing Persian messages of the actions API. All text comes from the dictionary (lib/i18n/fa; the
// actions-only strings are in lib/i18n/ns/actionsMsg.ts). Do not add Persian text to lib/actions.
import { fa } from "@/lib/i18n/fa";
import type { ActionErrorCode, FlowErrorCode } from "./errors";

const LOCAL = fa.actionsMsg.local;

export const MESSAGES = {
  ...LOCAL,
  stale: fa.approval.stale,
  typedNameMismatch: fa.approval.typeNameMismatch,
  badRequest: fa.errors.badRequest,
  forbidden: fa.errors.forbidden,
  forbiddenOrigin: fa.errors.forbiddenOrigin,
  notFound: fa.errors.notFound,
  conflict: fa.errors.conflict,
  rateLimited: fa.errors.rateLimited,
  generic: fa.errors.generic,
} as const;

const BY_CODE: Readonly<Record<ActionErrorCode, string>> = {
  invalid: fa.errors.badRequest,
  missing_user_value: fa.errors.badRequest,
  unexpected_user_value: fa.errors.badRequest,
  public_key_forbidden: fa.errors.badRequest,
  env_source_missing: LOCAL.envSourceMissing,
  encrypted_env_masked: LOCAL.encryptedMasked,
  different_network: LOCAL.differentNetwork,
  ambiguous_network: LOCAL.ambiguousNetwork,
  human_only: fa.errors.forbidden,
  ai_not_allowed: fa.errors.forbidden,
  use_proposal_flow: LOCAL.useProposalFlow,
  not_found: fa.errors.notFound,
  conflict: fa.errors.conflict,
  insufficient_balance: LOCAL.insufficientBalance,
  payment_required: LOCAL.insufficientBalance,
  team_balance_unreadable: LOCAL.teamBalanceUnreadable,
  plan_price_unknown: LOCAL.planPriceUnknown,
  forbidden: fa.errors.forbidden,
  precondition: LOCAL.precondition,
  rate_limited: fa.errors.rateLimited,
  unsupported: LOCAL.unsupported,
  app_stopped: LOCAL.appStopped,
  release_failed: LOCAL.releaseFailed,
  readback_mismatch: LOCAL.readbackMismatch,
  outcome_unknown: LOCAL.outcomeUnknown,
  step_failed: LOCAL.stepFailed,
  liara_auth: fa.errors.unauthorized,
  liara_timeout: fa.errors.liaraTimeout,
  liara_unavailable: fa.errors.liaraUnavailable,
  liara_bad_response: fa.errors.liaraBadResponse,
  aborted: fa.errors.generic,
  internal: fa.errors.generic,
};

export function messageFor(code: ActionErrorCode): string {
  return BY_CODE[code];
}

const BY_FLOW_CODE: Readonly<Record<FlowErrorCode, string>> = {
  bad_request: fa.errors.badRequest,
  typed_name_mismatch: fa.approval.typeNameMismatch,
  approval_token_invalid: LOCAL.tokenInvalid,
  human_only: fa.errors.forbidden,
  ai_not_allowed: fa.errors.forbidden,
  not_found: fa.errors.notFound,
  stale: fa.approval.stale,
  expired: LOCAL.expired,
  wrong_status: LOCAL.wrongStatus,
  conflict: fa.errors.conflict,
  integrity: fa.errors.generic,
  state_unreadable: fa.errors.liaraUnavailable,
};

export function flowMessageFor(code: FlowErrorCode): string {
  return BY_FLOW_CODE[code];
}

/** Labels of the incident Markdown export (fa keys where they exist). */
const M = fa.actionsMsg.md;
export const MD_LABELS = {
  title: M.title,
  target: fa.approval.target,
  startedAt: M.startedAt,
  resolvedAt: M.resolvedAt,
  open: M.open,
  observed: fa.copilot.observed,
  inferred: fa.copilot.inferred,
  unclear: fa.copilot.unclear,
  ruledOut: M.ruledOut,
  evidence: fa.copilot.evidence,
  level: {
    strong: fa.copilot.evidenceLevel.strong,
    medium: fa.copilot.evidenceLevel.medium,
    weak: fa.copilot.evidenceLevel.weak,
    insufficient: fa.copilot.unclear,
  },
  proposal: fa.approval.operation,
  verification: fa.approval.verificationPlan,
  outcome: M.outcome,
  passed: M.passed,
  failedCheck: M.failedCheck,
  checkStatus: { passed: M.passed, failed: M.failedCheck, unknown: M.unknownCheck, skipped: M.skippedCheck },
  before: M.before,
  after: M.after,
  timeline: M.timeline,
  limits: M.limits,
  howToGet: M.howToGet,
  none: fa.common.none,
} as const;
