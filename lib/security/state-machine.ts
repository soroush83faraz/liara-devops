import { randomBytes } from "node:crypto";
import { ACTION_POLICY, ActionParamsSchema, actionTarget, type ActionParams, type ActionType } from "../contracts/action";
import type { Cost } from "../contracts/common";
import {
  PROPOSAL_MAX_TTL_MS,
  PROPOSAL_TTL_MS,
  ProposalSchema,
  TERMINAL_PROPOSAL_STATUSES,
  type Proposal,
  type ProposalSource,
  type ProposalStatus,
} from "../contracts/proposal";
import { hashParams, sha256Hex } from "./canonical";
import type { Store } from "./store";

/**
 * Proposal lifecycle:
 *   proposed -> approved | rejected | expired | stale
 *   approved -> executing | rejected | expired | stale
 *   executing -> verifying | failed
 *   verifying -> verified | not_verified | failed
 * Terminal states never change. Expired proposals can neither be approved nor
 * claimed for execution. `claimExecution` is the exactly-once gate: an atomic
 * compare-and-set approved -> executing under the store lock. A user may still
 * reject an APPROVED proposal (changed their mind before executing): rejection is
 * terminal, and since execution requires the stored status to be `approved` at
 * the CAS, every approval token minted before the rejection becomes useless.
 */

export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = Object.freeze({
  proposed: Object.freeze<ProposalStatus[]>(["approved", "rejected", "expired", "stale"]),
  approved: Object.freeze<ProposalStatus[]>(["executing", "rejected", "expired", "stale"]),
  executing: Object.freeze<ProposalStatus[]>(["verifying", "failed"]),
  verifying: Object.freeze<ProposalStatus[]>(["verified", "not_verified", "failed"]),
  verified: Object.freeze<ProposalStatus[]>([]),
  not_verified: Object.freeze<ProposalStatus[]>([]),
  failed: Object.freeze<ProposalStatus[]>([]),
  rejected: Object.freeze<ProposalStatus[]>([]),
  expired: Object.freeze<ProposalStatus[]>([]),
  stale: Object.freeze<ProposalStatus[]>([]),
});

export type ProposalStateErrorCode = "illegal_transition" | "proposal_expired" | "integrity";

export class ProposalStateError extends Error {
  readonly code: ProposalStateErrorCode;
  constructor(code: ProposalStateErrorCode, message: string) {
    super(message);
    this.name = "ProposalStateError";
    this.code = code;
  }
}

const toMs = (now: number | Date) => (typeof now === "number" ? now : now.getTime());
const terminal = new Set<string>(TERMINAL_PROPOSAL_STATUSES);

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  if (!Object.prototype.hasOwnProperty.call(PROPOSAL_TRANSITIONS, from)) return false;
  return PROPOSAL_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ProposalStatus): boolean {
  return terminal.has(status);
}

/** True at or after `expiresAt` (an unparsable expiry counts as expired). */
export function isExpired(p: Pick<Proposal, "expiresAt">, now: number | Date = Date.now()): boolean {
  const exp = Date.parse(p.expiresAt);
  return !Number.isFinite(exp) || toMs(now) >= exp;
}

/** Pure: returns a new proposal in status `to`; throws ProposalStateError when not allowed. */
export function transition(p: Proposal, to: ProposalStatus, now: number | Date = Date.now()): Proposal {
  if (!canTransition(p.status, to)) {
    throw new ProposalStateError("illegal_transition", `illegal transition ${p.status} -> ${to}`);
  }
  if ((to === "approved" || to === "executing") && isExpired(p, now)) {
    throw new ProposalStateError("proposal_expired", "proposal expired");
  }
  const at = new Date(toMs(now)).toISOString();
  return {
    ...p,
    status: to,
    updatedAt: at,
    history: [...(p.history ?? []), { status: to, at }].slice(-20),
  };
}

export function computeExpiresAt(createdAt: number | Date, ttlMs: number = PROPOSAL_TTL_MS): string {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > PROPOSAL_MAX_TTL_MS) throw new RangeError("ttlMs out of range");
  return new Date(toMs(createdAt) + ttlMs).toISOString();
}

export function newProposalId(): string {
  return `p_${randomBytes(16).toString("base64url")}`;
}

/** Deterministic per (account, proposal, type, params); lowercase hex so redaction leaves it intact. */
export function makeIdempotencyKey(input: { accountId: string; proposalId: string; type: ActionType; paramsHash: string }): string {
  const digest = sha256Hex(`hamyar.idem.v1\n${input.accountId}\n${input.proposalId}\n${input.type}\n${input.paramsHash}`);
  return `idk_${digest.slice(0, 40)}`;
}

export interface CreateProposalInput {
  accountId: string;
  params: ActionParams;
  source: ProposalSource;
  rationaleFa: string;
  evidenceIds: string[];
  effectFa: string;
  risksFa: string[];
  verificationPlan: string[];
  costEstimate?: Cost;
  /** fingerprintState(...) of the Liara state the proposal is based on. */
  stateFingerprint: string;
  ttlMs?: number;
}

/**
 * Builds a proposal with every derived field computed here (never taken from the
 * model): id, status, type, target, reversibility, timestamps, paramsHash,
 * idempotency key. Throws (ZodError) when the result violates the contract,
 * e.g. an agent-sourced delete or an uncited agent proposal.
 */
export function createProposal(input: CreateProposalInput, now: number | Date = Date.now()): Proposal {
  const params = ActionParamsSchema.parse(input.params);
  const id = newProposalId();
  const createdAt = new Date(toMs(now)).toISOString();
  const paramsHash = hashParams(params);
  return ProposalSchema.parse({
    id,
    status: "proposed",
    type: params.type,
    target: actionTarget(params),
    params,
    rationaleFa: input.rationaleFa,
    evidenceIds: input.evidenceIds,
    effectFa: input.effectFa,
    risksFa: input.risksFa,
    reversible: ACTION_POLICY[params.type].reversible,
    costEstimate: input.costEstimate,
    verificationPlan: input.verificationPlan,
    createdAt,
    expiresAt: computeExpiresAt(now, input.ttlMs),
    updatedAt: createdAt,
    source: input.source,
    paramsHash,
    idempotencyKey: makeIdempotencyKey({ accountId: input.accountId, proposalId: id, type: params.type, paramsHash }),
    stateFingerprint: input.stateFingerprint,
    history: [{ status: "proposed", at: createdAt }],
  });
}

/**
 * Re-validates a proposal from storage or a request: schema invariants plus the
 * params hash (which needs node:crypto, so the contract cannot check it).
 */
export function assertProposalIntegrity(value: unknown): Proposal {
  const r = ProposalSchema.safeParse(value);
  if (!r.success) throw new ProposalStateError("integrity", "proposal violates contract");
  if (hashParams(r.data.params) !== r.data.paramsHash) throw new ProposalStateError("integrity", "params hash mismatch");
  return r.data;
}

export type CasResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: "not_found" | "wrong_status" | "expired"; status?: ProposalStatus };

/**
 * Atomic compare-and-set: moves the stored proposal from one of `from` to `to`.
 * Moving to approved/executing an expired proposal records `expired` instead.
 */
export async function casTransition(
  store: Pick<Store, "proposals">,
  accountId: string,
  proposalId: string,
  from: readonly ProposalStatus[],
  to: ProposalStatus,
  now: number | Date = Date.now(),
): Promise<CasResult> {
  let result: CasResult = { ok: false, reason: "not_found" };
  await store.proposals.update(accountId, proposalId, (current) => {
    if (current === undefined) {
      result = { ok: false, reason: "not_found" };
      return undefined;
    }
    if (!from.includes(current.status) || !canTransition(current.status, to)) {
      result = { ok: false, reason: "wrong_status", status: current.status };
      return undefined;
    }
    if ((to === "approved" || to === "executing") && isExpired(current, now)) {
      result = { ok: false, reason: "expired", status: "expired" };
      return transition(current, "expired", now);
    }
    const next = transition(current, to, now);
    result = { ok: true, proposal: next };
    return next;
  });
  return result;
}

export type ClaimResult =
  | { claimed: true; proposal: Proposal }
  | { claimed: false; reason: "not_found" | "not_approved" | "expired"; status?: ProposalStatus };

/**
 * Exactly-once execution gate. Under concurrent double submits exactly one caller
 * gets `claimed: true`; all others see the proposal already `executing` (or later).
 */
export async function claimExecution(
  store: Pick<Store, "proposals">,
  accountId: string,
  proposalId: string,
  now: number | Date = Date.now(),
): Promise<ClaimResult> {
  const r = await casTransition(store, accountId, proposalId, ["approved"], "executing", now);
  if (r.ok) return { claimed: true, proposal: r.proposal };
  if (r.reason === "wrong_status") return { claimed: false, reason: "not_approved", status: r.status };
  return { claimed: false, reason: r.reason, status: r.status };
}

/** Marks a proposed/approved proposal `expired` once its TTL has passed. */
export async function expireIfDue(
  store: Pick<Store, "proposals">,
  accountId: string,
  proposalId: string,
  now: number | Date = Date.now(),
): Promise<Proposal | undefined> {
  return store.proposals.update(accountId, proposalId, (current) =>
    current && (current.status === "proposed" || current.status === "approved") && isExpired(current, now)
      ? transition(current, "expired", now)
      : undefined,
  );
}
