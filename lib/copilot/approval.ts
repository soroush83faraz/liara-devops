// Approval dialog state machine (pure). The component owns the network calls; this module decides what is allowed.
//   review -> approving -> executing -> submitted
//   review|approving|executing -> stale | expired | conflict | unauthorized | forbidden | rate_limited | error
//   executing -> unknown_result (no response: never retried automatically; user checks the real status first)
// Secrets: `values` holds user-typed env values in component state only. `beginSubmit` moves them into the one
// request payload and clears them from the state in the same step, so a re-render, retry or double click can't resend.
import { ACTION_POLICY, userValueKeys, type Proposal, type ProposalStatus } from "@/lib/contracts";
import { matchesName } from "@/components/ui/confirm-match";
import type { ErrorKind } from "./stream-client";

export type ApprovalPhase =
  | "review"
  | "approving"
  | "executing"
  | "submitted"
  | "stale"
  | "expired"
  | "blocked"
  | "rejected"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "unknown_result"
  | "error";

export type BlockedReason = "human_only" | "status";
export type ErrorReason = "bad_name" | "token" | "network" | "generic";

export interface ApprovalState {
  phase: ApprovalPhase;
  typedName: string;
  values: Record<string, string>;
  blockedReason?: BlockedReason;
  /** Proposal status that blocked the dialog (already processed elsewhere). */
  blockedStatus?: ProposalStatus;
  errorReason?: ErrorReason;
  retryAfterSec?: number;
  /** After "check status": the request never started, re-approving is safe. */
  notStarted?: boolean;
}

export interface Requirements {
  tier: 1 | 2 | 3;
  typedName: boolean;
  userKeys: string[];
  billed: boolean;
  humanOnly: boolean;
}

export function requirements(p: Proposal): Requirements {
  const policy = ACTION_POLICY[p.type];
  return {
    tier: policy.tier === 0 ? 1 : policy.tier,
    typedName: policy.requiresTypedName,
    userKeys: userValueKeys(p.params),
    billed: policy.billed || p.costEstimate !== undefined,
    humanOnly: policy.tier === 3 || (p.source === "agent" && !policy.aiProposable),
  };
}

const ALREADY_PROCESSED: readonly ProposalStatus[] = ["approved", "executing", "verifying", "verified", "not_verified", "failed"];

export function initialState(p: Proposal, now: number): ApprovalState {
  const base: ApprovalState = { phase: "review", typedName: "", values: {} };
  if (requirements(p).humanOnly) return { ...base, phase: "blocked", blockedReason: "human_only" };
  if (p.status === "stale") return { ...base, phase: "stale" };
  if (p.status === "expired") return { ...base, phase: "expired" };
  if (p.status === "rejected") return { ...base, phase: "rejected" };
  if (ALREADY_PROCESSED.includes(p.status)) return { ...base, phase: "blocked", blockedReason: "status", blockedStatus: p.status };
  if (now >= Date.parse(p.expiresAt)) return { ...base, phase: "expired" };
  return base;
}

export function setTypedName(s: ApprovalState, value: string): ApprovalState {
  return s.phase === "review" || s.phase === "error" ? { ...s, typedName: value } : s;
}

export function setValue(s: ApprovalState, key: string, value: string): ApprovalState {
  if (s.phase !== "review" && s.phase !== "error") return s;
  return { ...s, values: { ...s.values, [key]: value } };
}

export function isExpired(p: Proposal, now: number): boolean {
  return now >= Date.parse(p.expiresAt);
}

/** Moves a review/error dialog to `expired` once the proposal TTL has passed. */
export function tick(s: ApprovalState, p: Proposal, now: number): ApprovalState {
  if ((s.phase === "review" || s.phase === "error") && isExpired(p, now)) return { ...s, phase: "expired", values: {} };
  return s;
}

export function canConfirm(s: ApprovalState, p: Proposal, now: number): boolean {
  if (s.phase !== "review" && s.phase !== "error") return false;
  const req = requirements(p);
  if (req.humanOnly || isExpired(p, now)) return false;
  if (req.typedName && !matchesName(s.typedName, p.target.name)) return false;
  return req.userKeys.every((k) => (s.values[k] ?? "").length > 0);
}

export interface SubmitPayload {
  typedName?: string;
  userValues: Record<string, string>;
}

/**
 * Starts a submission. Returns null when not allowed (including a second click while one is in flight).
 * The returned state has NO values left; the payload is the only holder.
 */
export function beginSubmit(s: ApprovalState, p: Proposal, now: number): { state: ApprovalState; payload: SubmitPayload } | null {
  if (!canConfirm(s, p, now)) return null;
  const req = requirements(p);
  const userValues: Record<string, string> = {};
  for (const k of req.userKeys) userValues[k] = s.values[k] ?? "";
  return {
    state: { ...s, phase: "approving", values: {}, errorReason: undefined, notStarted: undefined },
    payload: { typedName: req.typedName ? p.target.name : undefined, userValues },
  };
}

export function approveSucceeded(s: ApprovalState): ApprovalState {
  return s.phase === "approving" ? { ...s, phase: "executing" } : s;
}

export function executeSucceeded(s: ApprovalState): ApprovalState {
  return s.phase === "executing" ? { ...s, phase: "submitted", values: {}, typedName: "" } : s;
}

export interface Failure {
  kind: ErrorKind;
  status?: number;
  code: string;
  retryAfterSec?: number;
}

export type Stage = "approve" | "execute";

/** Maps a failed request onto a dialog phase. `stage` matters: a lost execute response is NOT a safe retry. */
export function failed(s: ApprovalState, stage: Stage, f: Failure): ApprovalState {
  const code = f.code.toLowerCase();
  const clear = { values: {} as Record<string, string> };
  if (code.includes("stale")) return { ...s, ...clear, phase: "stale" };
  if (code.includes("expired") || f.status === 410) return { ...s, ...clear, phase: "expired" };
  if (code.includes("typed_name")) return { ...s, ...clear, phase: "error", errorReason: "bad_name" };
  if (stage === "execute" && code.startsWith("token")) return { ...s, ...clear, phase: "error", errorReason: "token" };
  if (f.kind === "unauthorized") return { ...s, ...clear, phase: "unauthorized" };
  if (f.kind === "forbidden") return { ...s, ...clear, phase: "forbidden" };
  if (f.kind === "rateLimited") return { ...s, ...clear, phase: "rate_limited", retryAfterSec: f.retryAfterSec };
  if (f.kind === "conflict") return { ...s, ...clear, phase: "conflict" };
  const transport = f.kind === "network" || f.kind === "server" || f.kind === "timeout" || f.kind === "stream";
  if (stage === "execute" && transport) return { ...s, ...clear, phase: "unknown_result" };
  return { ...s, ...clear, phase: "error", errorReason: f.kind === "network" ? "network" : "generic" };
}

/** Result of re-reading the proposal after an unknown result: decide whether the execution actually started. */
export function statusChecked(s: ApprovalState, status: ProposalStatus): ApprovalState {
  if (s.phase !== "unknown_result") return s;
  if (status === "approved") return { ...s, phase: "review", notStarted: true, typedName: "", values: {} };
  if (status === "proposed") return { ...s, phase: "review", notStarted: true, typedName: "", values: {} };
  if (status === "stale") return { ...s, phase: "stale" };
  if (status === "expired") return { ...s, phase: "expired" };
  if (status === "rejected") return { ...s, phase: "rejected" };
  return { ...s, phase: "submitted" };
}

export const TERMINAL_PHASES: readonly ApprovalPhase[] = ["stale", "expired", "blocked", "rejected", "submitted"];
