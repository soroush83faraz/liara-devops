// Typed errors of the actions layer. SECURITY: an ActionError never carries upstream text (Liara messages or
// bodies may echo env values); it holds a code, an HTTP status and secret-free details (codes, key names, ids).
import { isLiaraError, type LiaraError } from "@/lib/liara";

export const ACTION_ERROR_CODES = [
  "invalid",
  "missing_user_value",
  "unexpected_user_value",
  "public_key_forbidden",
  "env_source_missing",
  "encrypted_env_masked",
  "different_network",
  "ambiguous_network",
  "human_only",
  "ai_not_allowed",
  "use_proposal_flow",
  "not_found",
  "conflict",
  "insufficient_balance",
  "team_balance_unreadable",
  "payment_required",
  "plan_price_unknown",
  "forbidden",
  "precondition",
  "rate_limited",
  "unsupported",
  "app_stopped",
  "release_failed",
  "readback_mismatch",
  "outcome_unknown",
  "step_failed",
  "liara_auth",
  "liara_timeout",
  "liara_unavailable",
  "liara_bad_response",
  "aborted",
  "internal",
] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

const STATUS: Readonly<Record<ActionErrorCode, number>> = {
  invalid: 400,
  missing_user_value: 400,
  unexpected_user_value: 400,
  public_key_forbidden: 400,
  env_source_missing: 422,
  encrypted_env_masked: 409,
  different_network: 422,
  ambiguous_network: 409,
  human_only: 403,
  ai_not_allowed: 403,
  use_proposal_flow: 400,
  not_found: 404,
  conflict: 409,
  insufficient_balance: 402,
  team_balance_unreadable: 402,
  payment_required: 402,
  plan_price_unknown: 422,
  forbidden: 403,
  precondition: 428,
  rate_limited: 429,
  unsupported: 501,
  app_stopped: 409,
  release_failed: 502,
  readback_mismatch: 502,
  outcome_unknown: 504,
  step_failed: 502,
  liara_auth: 401,
  liara_timeout: 504,
  liara_unavailable: 502,
  liara_bad_response: 502,
  aborted: 503,
  internal: 500,
};

export type SafeValue = string | number | boolean | null | readonly SafeValue[] | { readonly [k: string]: SafeValue };
export type SafeDetails = Readonly<Record<string, SafeValue>>;

export interface ActionErrorInit {
  details?: SafeDetails;
  /** Re-read state after an uncertain mutation (secret-free). */
  after?: Readonly<Record<string, unknown>>;
  knownSecrets?: Iterable<string>;
  retryAfterSec?: number;
}

export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly status: number;
  readonly details?: SafeDetails;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly retryAfterSec?: number;
  /** Values to scrub from anything derived from this error. Non-enumerable: never serialized. */
  declare readonly knownSecrets: readonly string[];

  constructor(code: ActionErrorCode, init: ActionErrorInit = {}) {
    super(code);
    this.name = "ActionError";
    this.code = code;
    this.status = STATUS[code];
    if (init.details !== undefined) this.details = init.details;
    if (init.after !== undefined) this.after = init.after;
    if (init.retryAfterSec !== undefined) this.retryAfterSec = init.retryAfterSec;
    Object.defineProperty(this, "knownSecrets", {
      value: Object.freeze([...(init.knownSecrets ?? [])]),
      enumerable: false,
      writable: false,
    });
  }

  /** Copy with more secrets attached (knownSecrets is frozen). */
  withSecrets(secrets: Iterable<string>): ActionError {
    return new ActionError(this.code, {
      details: this.details,
      after: this.after,
      retryAfterSec: this.retryAfterSec,
      knownSecrets: [...this.knownSecrets, ...secrets],
    });
  }

  toJSON() {
    return { code: this.code, ...(this.details ? { details: this.details } : {}) };
  }
}

export const isActionError = (e: unknown): e is ActionError => e instanceof ActionError;

const SAFE_CODE = /^[a-z0-9_]{1,64}$/;

/** Liara's own error code (e.g. `frozen_project`), only when it is a plain snake_case token. */
export function safeLiaraCode(e: LiaraError): string | undefined {
  return typeof e.code === "string" && SAFE_CODE.test(e.code) ? e.code : undefined;
}

/**
 * A mutation whose outcome is unknown: the request may have been applied (timeout, connection lost, 5xx,
 * our own abort, or a 2xx with an unreadable body). Such a call is NEVER retried; callers re-read state.
 */
export function isUncertainMutationError(e: unknown): boolean {
  if (!isLiaraError(e)) return false;
  if (e.kind === "timeout" || e.kind === "server" || e.kind === "network") return true;
  return e.kind === "unknown" && e.code === "schema_mismatch";
}

/** Maps a definite Liara failure (the request was refused, nothing applied) onto an ActionError. */
export function fromLiaraError(e: LiaraError, step?: string): ActionError {
  const liaraCode = safeLiaraCode(e);
  const details: Record<string, SafeValue> = {};
  if (step) details.step = step;
  if (liaraCode) details.liaraCode = liaraCode;
  const retryAfterSec = e.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : undefined;
  const make = (code: ActionErrorCode) => new ActionError(code, { details, retryAfterSec });
  switch (e.kind) {
    case "auth":
      return make("liara_auth");
    case "forbidden":
      return make("forbidden");
    case "not_found":
      return make("not_found");
    case "conflict":
      return make("conflict");
    case "rate_limited":
      return make("rate_limited");
    case "payment":
      return make("payment_required");
    case "validation":
      return make(e.status === 428 ? "precondition" : "invalid");
    case "timeout":
      return make("liara_timeout");
    case "network":
      return make(e.code === "aborted" ? "aborted" : "liara_unavailable");
    case "server":
      return make("liara_unavailable");
    default:
      return make("liara_bad_response");
  }
}

/* ------------------------------------------------------------ proposal flow */

export const FLOW_ERROR_STATUS = {
  bad_request: 400,
  typed_name_mismatch: 400,
  approval_token_invalid: 403,
  human_only: 403,
  ai_not_allowed: 403,
  not_found: 404,
  stale: 409,
  expired: 409,
  wrong_status: 409,
  conflict: 409,
  integrity: 409,
  state_unreadable: 503,
} as const;
export type FlowErrorCode = keyof typeof FLOW_ERROR_STATUS;

/** Refusals of the approve/execute/reject gates (nothing was executed). */
export class FlowError extends Error {
  readonly code: FlowErrorCode;
  readonly status: number;
  readonly details?: SafeDetails;
  constructor(code: FlowErrorCode, details?: SafeDetails) {
    super(code);
    this.name = "FlowError";
    this.code = code;
    this.status = FLOW_ERROR_STATUS[code];
    if (details !== undefined) this.details = details;
  }
}

/** Normalizes anything thrown inside an action into an ActionError carrying `secrets`. */
export function toActionError(e: unknown, secrets: Iterable<string> = [], step?: string): ActionError {
  if (isActionError(e)) return e.withSecrets(secrets);
  if (isLiaraError(e)) return fromLiaraError(e, step).withSecrets(secrets);
  return new ActionError("internal", { details: step ? { step } : undefined, knownSecrets: secrets });
}
