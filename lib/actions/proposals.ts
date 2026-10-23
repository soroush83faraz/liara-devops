// Proposal lifecycle gates. Mandatory order for the mutating calls (origin + rate limit happen in the HTTP layer
// first; accountId always comes from the session):
//   approve: integrity -> status/policy -> state fingerprint (stale => 409) -> typed name -> proposed->approved
//            -> mint a one-time token bound to {proposal, account+team, target, type, paramsHash} (TTL <= expiry)
//   execute: integrity -> status/policy -> user values -> fingerprint -> target lock -> verifyApprovalToken
//            (burns the nonce) -> claimExecution (exactly once) -> background job (no retry) -> audit
// The typed name is checked at approve; the token is only minted after it passed, so it carries that proof.
import type { LiaraClient } from "@/lib/liara";
import { ACTION_POLICY, ActionParamsSchema, actionTarget, type ActionParams } from "@/lib/contracts/action";
import type { Proposal, ProposalStatus } from "@/lib/contracts/proposal";
import { PolicyError, assertTypedName, requiredConfirmation } from "@/lib/security/policy";
import {
  ProposalStateError,
  assertProposalIntegrity,
  casTransition,
  claimExecution,
  createProposal,
  expireIfDue,
  isExpired,
  type CreateProposalInput,
} from "@/lib/security/state-machine";
import { StoreError, type Store } from "@/lib/security/store";
import { APPROVAL_TOKEN_DEFAULT_TTL_MS, ApprovalTokenError, mintApprovalToken, verifyApprovalToken } from "@/lib/security/tokens";
import { SAFE_ID_RE } from "@/lib/contracts/common";
import { auditSafe } from "./audit-log";
import { ActionError, FlowError } from "./errors";
import { publishProposal } from "./events";
import { assertParamsMayRun, assertUserValues } from "./executors";
import { computeTargetFingerprint } from "./fingerprint";
import { jobKey, runningJobs, targetLockKey, tryLockTarget } from "./globals";
import { findIncidentByProposal, recordIncidentEvent } from "./incidents";
import { runProposalJob, type JobDeps } from "./job";
import { safeLog } from "./log";

export interface FlowDeps {
  store: Store;
  now: () => number;
  /** Explicit HMAC key (tests); defaults to the env-derived approval key. */
  tokenKey?: Uint8Array;
}

/** The session's identity: account (hashed user) + team ("" for the personal account). */
export interface FlowScope {
  accountId: string;
  teamId: string;
}

export interface FlowCtx {
  liara: LiaraClient;
  scope: FlowScope;
}

/** Token `acc` claim: binds approvals to the account AND the team context they were made in. */
export const tokenAccount = (scope: FlowScope): string => (scope.teamId ? `${scope.accountId}|team:${scope.teamId}` : scope.accountId);

/** Longer than the job deadline: an executing proposal with no job in this process after this is interrupted. */
export const STUCK_AFTER_MS = 45 * 60_000;

/* ------------------------------------------------------------------ reads */

async function reconcile(deps: FlowDeps, accountId: string, p: Proposal): Promise<Proposal> {
  const now = deps.now();
  if ((p.status === "proposed" || p.status === "approved") && isExpired(p, now)) {
    const expired = (await expireIfDue(deps.store, accountId, p.id, now)) ?? p;
    if (expired.status === "expired") publishProposal(accountId, expired, true);
    return expired;
  }
  if ((p.status === "executing" || p.status === "verifying") && !runningJobs().has(jobKey(accountId, p.id))) {
    const since = Date.parse(p.updatedAt ?? p.createdAt);
    if (Number.isFinite(since) && now - since > STUCK_AFTER_MS) {
      try {
        const r = await casTransition(deps.store, accountId, p.id, [p.status], "failed", now);
        if (r.ok) {
          await auditSafe(deps.store, accountId, {
            actor: "system",
            action: "proposal.interrupted",
            target: p.target,
            paramsHash: p.paramsHash,
            result: "error",
            detail: "execution interrupted (server restart); outcome unknown",
            proposalId: p.id,
          });
          publishProposal(accountId, r.proposal, true);
          return r.proposal;
        }
      } catch (e) {
        safeLog("stuck_reconcile_failed", e);
      }
    }
  }
  return p;
}

/** Integrity-checked proposal of this account, or undefined. Expiry and interrupted executions are applied. */
export async function loadProposal(deps: FlowDeps, accountId: string, id: string): Promise<Proposal | undefined> {
  if (typeof id !== "string" || !SAFE_ID_RE.test(id)) return undefined;
  let raw: Proposal | undefined;
  try {
    raw = await deps.store.proposals.get(accountId, id);
  } catch (e) {
    if (e instanceof StoreError) throw new FlowError("integrity");
    throw e;
  }
  if (!raw) return undefined;
  let p: Proposal;
  try {
    p = assertProposalIntegrity(raw);
  } catch (e) {
    if (e instanceof ProposalStateError) throw new FlowError("integrity");
    throw e;
  }
  return reconcile(deps, accountId, p);
}

async function mustLoad(deps: FlowDeps, accountId: string, id: string): Promise<Proposal> {
  const p = await loadProposal(deps, accountId, id);
  if (!p) throw new FlowError("not_found");
  return p;
}

export async function listProposals(deps: FlowDeps, accountId: string, opts: { limit?: number; status?: ProposalStatus } = {}): Promise<Proposal[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 100));
  const out: Proposal[] = [];
  for (const raw of await deps.store.proposals.list(accountId, { limit: opts.status ? 500 : limit })) {
    let p: Proposal;
    try {
      p = await reconcile(deps, accountId, assertProposalIntegrity(raw));
    } catch {
      continue;
    }
    if (!opts.status || p.status === opts.status) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Creates and persists a proposal with the state fingerprint computed here (the only `put` in this module).
 * For agent/setup callers that want the canonical fingerprint without wiring it themselves.
 */
export async function storeNewProposal(
  deps: FlowDeps,
  ctx: { liara: LiaraClient; accountId: string },
  input: Omit<CreateProposalInput, "accountId" | "stateFingerprint">,
): Promise<Proposal> {
  const params: ActionParams = ActionParamsSchema.parse(input.params);
  const stateFingerprint = await computeTargetFingerprint(ctx.liara, actionTarget(params));
  const proposal = createProposal({ ...input, params, accountId: ctx.accountId, stateFingerprint }, deps.now());
  await deps.store.proposals.put(ctx.accountId, proposal.id, proposal);
  return proposal;
}

/* ------------------------------------------------------------------ gates */

/** Tier-3 deletes are human-only and exist only on /api/ops; no proposal can ever run one. */
function assertProposalPolicy(p: Proposal): void {
  if (ACTION_POLICY[p.type].tier === 3) throw new FlowError("human_only", { type: p.type });
  try {
    assertParamsMayRun(p.params, p.source);
  } catch (e) {
    if (e instanceof ActionError) throw new FlowError(e.code === "human_only" ? "human_only" : "ai_not_allowed", { type: p.type });
    throw e;
  }
}

async function assertFresh(deps: FlowDeps, ctx: FlowCtx, p: Proposal, from: ProposalStatus[]): Promise<void> {
  let current: string;
  try {
    current = await computeTargetFingerprint(ctx.liara, p.target);
  } catch {
    // Unknown state is not "unchanged": refuse, but do not mark stale (a retry may succeed).
    throw new FlowError("state_unreadable");
  }
  if (current === p.stateFingerprint) return;
  const r = await casTransition(deps.store, ctx.scope.accountId, p.id, from, "stale", deps.now());
  await auditSafe(deps.store, ctx.scope.accountId, {
    actor: "user",
    action: "proposal.stale",
    target: p.target,
    paramsHash: p.paramsHash,
    result: "denied",
    detail: "state changed since the proposal",
    proposalId: p.id,
  });
  if (r.ok) {
    publishProposal(ctx.scope.accountId, r.proposal, true);
    const incident = await findIncidentByProposal(deps.store, ctx.scope.accountId, p.id);
    if (incident) await recordIncidentEvent(deps.store, ctx.scope.accountId, incident.id, "stale", { refId: p.id }).catch(() => undefined);
  }
  throw new FlowError("stale");
}

function statusError(status: ProposalStatus): FlowError {
  return status === "expired" ? new FlowError("expired") : new FlowError("wrong_status", { status });
}

export interface ApproveResult {
  approvalToken: string;
  /** ISO; never later than the proposal's own expiry. */
  expiresAt: string;
  proposal: Proposal;
}

export async function approveProposal(deps: FlowDeps, ctx: FlowCtx, id: string, body: { typedName?: string }): Promise<ApproveResult> {
  const { accountId } = ctx.scope;
  const p = await mustLoad(deps, accountId, id);
  if (p.status !== "proposed" && p.status !== "approved") throw statusError(p.status);
  assertProposalPolicy(p);
  await assertFresh(deps, ctx, p, ["proposed", "approved"]);

  const conf = requiredConfirmation(p.type);
  if (conf.typedName || conf.tier >= 2) {
    try {
      assertTypedName(body.typedName, p.target.name);
    } catch (e) {
      if (!(e instanceof PolicyError)) throw e;
      await auditSafe(deps.store, accountId, { actor: "user", action: "proposal.approve", target: p.target, paramsHash: p.paramsHash, result: "denied", detail: "typed_name_mismatch", proposalId: p.id });
      throw new FlowError("typed_name_mismatch");
    }
  }

  let approved = p;
  if (p.status === "proposed") {
    const r = await casTransition(deps.store, accountId, p.id, ["proposed"], "approved", deps.now());
    if (!r.ok) throw r.reason === "not_found" ? new FlowError("not_found") : statusError(r.status ?? "expired");
    approved = r.proposal;
  }
  const now = deps.now();
  const ttlMs = Math.floor(Math.min(APPROVAL_TOKEN_DEFAULT_TTL_MS, Date.parse(approved.expiresAt) - now));
  if (!(ttlMs >= 1000)) throw new FlowError("expired");
  const minted = mintApprovalToken(
    { proposalId: approved.id, accountId: tokenAccount(ctx.scope), targetName: approved.target.name, type: approved.type, paramsHash: approved.paramsHash, ttlMs },
    { key: deps.tokenKey, now },
  );
  await auditSafe(deps.store, accountId, { actor: "user", action: "proposal.approve", target: approved.target, paramsHash: approved.paramsHash, result: "ok", proposalId: approved.id });
  publishProposal(accountId, approved);
  return { approvalToken: minted.token, expiresAt: new Date(minted.expiresAt).toISOString(), proposal: approved };
}

export interface ExecuteStarted {
  proposalId: string;
  status: "executing";
  /** Settles when execution + verification finished; never rejects. Schedule it with after(). */
  job: Promise<void>;
}

export async function executeProposal(
  deps: JobDeps,
  ctx: FlowCtx,
  id: string,
  body: { approvalToken: unknown; userValues?: unknown },
): Promise<ExecuteStarted> {
  const { accountId, teamId } = ctx.scope;
  const p = await mustLoad(deps, accountId, id);
  if (p.status !== "approved") throw statusError(p.status);
  assertProposalPolicy(p);
  let userValues: Record<string, string>;
  try {
    userValues = assertUserValues(p.params, body.userValues);
  } catch (e) {
    if (e instanceof ActionError) throw new FlowError("bad_request", { reason: e.code, ...(e.details ? { details: e.details } : {}) });
    throw e;
  }
  await assertFresh(deps, ctx, p, ["approved"]);

  const release = tryLockTarget(targetLockKey(accountId, teamId, p.target));
  if (!release) throw new FlowError("conflict", { reason: "target_busy" });
  let handedOff = false;
  try {
    try {
      await verifyApprovalToken(
        body.approvalToken,
        { proposalId: p.id, accountId: tokenAccount(ctx.scope), targetName: p.target.name, type: p.type, paramsHash: p.paramsHash },
        { store: deps.store, key: deps.tokenKey, now: deps.now() },
      );
    } catch (e) {
      if (!(e instanceof ApprovalTokenError)) throw e;
      await auditSafe(deps.store, accountId, {
        actor: "user",
        action: "proposal.execute",
        target: p.target,
        paramsHash: p.paramsHash,
        result: "denied",
        // Phrased so the redactor's "<secret-ish key>: value" rule does not scrub the reason code.
        detail: `rejected_approval ${e.reason}`,
        proposalId: p.id,
      });
      throw new FlowError("approval_token_invalid");
    }
    const claim = await claimExecution(deps.store, accountId, p.id, deps.now());
    if (!claim.claimed) {
      if (claim.reason === "not_found") throw new FlowError("not_found");
      throw claim.reason === "expired" ? new FlowError("expired") : new FlowError("wrong_status", { status: claim.status ?? "unknown" });
    }
    const job = runProposalJob(deps, { liara: ctx.liara, scope: ctx.scope, proposal: claim.proposal, userValues, release });
    handedOff = true;
    return { proposalId: p.id, status: "executing", job };
  } finally {
    if (!handedOff) release();
  }
}

/**
 * Rejects a proposed OR approved proposal (terminal). This is also how outstanding approval tokens are revoked:
 * a token is bound to the proposal id, and execution needs the stored status to be `approved` both when it loads
 * the proposal and at the atomic approved -> executing claim, so no token minted before the rejection can ever
 * execute. A proposal that is already executing cannot be rejected (409).
 */
export async function rejectProposal(deps: FlowDeps, ctx: FlowCtx, id: string): Promise<{ proposal: Proposal }> {
  const { accountId } = ctx.scope;
  const p = await mustLoad(deps, accountId, id);
  const r = await casTransition(deps.store, accountId, p.id, ["proposed", "approved"], "rejected", deps.now());
  if (!r.ok) throw r.reason === "not_found" ? new FlowError("not_found") : statusError(r.status ?? p.status);
  await auditSafe(deps.store, accountId, { actor: "user", action: "proposal.reject", target: p.target, paramsHash: p.paramsHash, result: "ok", proposalId: p.id });
  publishProposal(accountId, r.proposal, true);
  const incident = await findIncidentByProposal(deps.store, accountId, p.id);
  if (incident) await recordIncidentEvent(deps.store, accountId, incident.id, "rejected", { refId: p.id }).catch(() => undefined);
  return { proposal: r.proposal };
}
