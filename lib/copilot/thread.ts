// Normalised copilot thread: one Turn per user question, each holding typed cards in arrival order.
// Pure and immutable (no React, no network) so the reducer is unit-testable. Same-id parts update a card in place,
// which makes replays (retry / resumed streams) idempotent, and status regressions (out-of-order events) are ignored.
import {
  copilotDataPartSchemas,
  type ErrorData,
  type ExecutionData,
  type Finding,
  type Incident,
  type Observation,
  type Proposal,
  type ProposalStatus,
  type StepData,
  type VerificationData,
} from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { stripUnsafeChars, truncate } from "./text";

export type Card =
  | { kind: "text"; key: string; id: string; text: string }
  | { kind: "step"; key: string; data: StepData }
  | { kind: "observation"; key: string; data: Observation }
  | { kind: "finding"; key: string; data: Finding }
  | { kind: "proposal"; key: string; data: Proposal }
  | { kind: "execution"; key: string; data: ExecutionData }
  | { kind: "verification"; key: string; data: VerificationData }
  | { kind: "incident"; key: string; data: Incident }
  | { kind: "error"; key: string; data: ErrorData; detail?: string };

export type CardOf<K extends Card["kind"]> = Extract<Card, { kind: K }>;

export type TurnStatus = "streaming" | "done" | "error" | "aborted";

export interface Turn {
  id: string;
  userText: string;
  cards: Card[];
  status: TurnStatus;
  /** Data parts that failed schema validation and were dropped. */
  invalidParts: number;
  /** The model was unavailable: findings are rule-based and have no prose. */
  degraded: boolean;
}

export type ThreadStatus = "idle" | "streaming" | "error";

export interface ThreadError {
  /** Machine code: http status class, `network`, `stream`, or a server error code. */
  code: string;
  status?: number;
  retryAfterSec?: number;
}

export interface Thread {
  turns: Turn[];
  status: ThreadStatus;
  error?: ThreadError;
  counter: number;
}

export const emptyThread = (): Thread => ({ turns: [], status: "idle", counter: 0 });

const LLM_DOWN_RE = /(^|[._:-])llm([._:-]|$)|(^|[._:-])model[._:-](unavailable|down)/;
/** `data-error` codes that mean "the model is down, rule-based findings follow" rather than "the run failed". */
export function isDegradeCode(code: string): boolean {
  return LLM_DOWN_RE.test(code);
}

const STEP_RANK: Record<StepData["status"], number> = { pending: 0, running: 1, done: 2, failed: 2, skipped: 2 };
const PROPOSAL_RANK: Record<ProposalStatus, number> = {
  proposed: 0,
  approved: 1,
  executing: 2,
  verifying: 3,
  verified: 4,
  not_verified: 4,
  failed: 4,
  rejected: 4,
  expired: 4,
  stale: 4,
};

export function proposalStatusRank(s: ProposalStatus): number {
  return PROPOSAL_RANK[s];
}

function mergeCard(prev: Card, next: Card): Card {
  if (prev.kind === "step" && next.kind === "step" && STEP_RANK[next.data.status] < STEP_RANK[prev.data.status]) return prev;
  if (prev.kind === "execution" && next.kind === "execution" && STEP_RANK[next.data.status] < STEP_RANK[prev.data.status]) return prev;
  if (prev.kind === "proposal" && next.kind === "proposal" && PROPOSAL_RANK[next.data.status] < PROPOSAL_RANK[prev.data.status]) {
    return prev;
  }
  return next;
}

function upsert(cards: Card[], next: Card): Card[] {
  const i = cards.findIndex((c) => c.key === next.key);
  if (i === -1) return [...cards, next];
  const merged = mergeCard(cards[i], next);
  if (merged === cards[i]) return cards;
  const copy = cards.slice();
  copy[i] = merged;
  return copy;
}

function mapTurn(thread: Thread, turnId: string, fn: (t: Turn) => Turn): Thread {
  const i = thread.turns.findIndex((t) => t.id === turnId);
  if (i === -1) return thread;
  const next = fn(thread.turns[i]);
  if (next === thread.turns[i]) return thread;
  const turns = thread.turns.slice();
  turns[i] = next;
  return { ...thread, turns };
}

export function startTurn(thread: Thread, userText: string): { thread: Thread; turnId: string } {
  const counter = thread.counter + 1;
  const turnId = `t${counter}`;
  const turn: Turn = { id: turnId, userText, cards: [], status: "streaming", invalidParts: 0, degraded: false };
  return { thread: { ...thread, counter, turns: [...thread.turns, turn], status: "streaming", error: undefined }, turnId };
}

/** Re-run an existing turn (retry): keeps data cards (they update in place), drops text and error cards. */
export function restartTurn(thread: Thread, turnId: string): Thread {
  const next = mapTurn(thread, turnId, (t) => ({
    ...t,
    status: "streaming",
    cards: t.cards.filter((c) => c.kind !== "text" && c.kind !== "error"),
  }));
  return { ...next, status: "streaming", error: undefined };
}

function dataKey(prefix: string, partId: string | undefined, fallback: string): string {
  return `${prefix}:${partId ?? fallback}`;
}

function cleanDetail(text: unknown): string | undefined {
  if (typeof text !== "string" || text.trim() === "") return undefined;
  return truncate(stripUnsafeChars(text), 200);
}

/** Applies one decoded UI-message chunk to a turn. Unknown chunk types are ignored; invalid data parts are counted. */
export function applyChunk(thread: Thread, turnId: string, chunk: unknown): Thread {
  if (chunk === null || typeof chunk !== "object") return thread;
  const c = chunk as { type?: unknown; id?: unknown; data?: unknown; delta?: unknown; errorText?: unknown };
  if (typeof c.type !== "string") return thread;
  const partId = typeof c.id === "string" && c.id.length > 0 && c.id.length <= 128 ? c.id : undefined;

  switch (c.type) {
    case "start":
      // A replayed stream re-sends its text: blank ours in place (keeps card order) so deltas are not doubled.
      return mapTurn(thread, turnId, (t) => ({ ...t, cards: t.cards.map((x) => (x.kind === "text" ? { ...x, text: "" } : x)) }));
    case "text-start":
    case "text-delta": {
      if (partId === undefined) return thread;
      const delta = c.type === "text-delta" && typeof c.delta === "string" ? stripUnsafeChars(c.delta) : "";
      return mapTurn(thread, turnId, (t) => {
        const key = `text:${partId}`;
        const existing = t.cards.find((x) => x.key === key);
        const text = c.type === "text-start" ? "" : `${existing?.kind === "text" ? existing.text : ""}${delta}`;
        return { ...t, cards: upsertText(t.cards, { kind: "text", key, id: partId, text }) };
      });
    }
    case "error":
      return mapTurn(thread, turnId, (t) => ({
        ...t,
        cards: upsert(t.cards, {
          kind: "error",
          key: `error:stream-${t.cards.length}`,
          data: { code: "stream.error", messageFa: fa.copilotUi.errors.stream },
          detail: cleanDetail(c.errorText),
        }),
      }));
    case "abort":
      return mapTurn(thread, turnId, (t) => abortTurnCards(t));
    default:
      break;
  }

  if (!c.type.startsWith("data-")) return thread;
  const name = c.type.slice(5);
  return mapTurn(thread, turnId, (t) => applyDataPart(t, name, partId, c.data));
}

function upsertText(cards: Card[], next: Extract<Card, { kind: "text" }>): Card[] {
  const i = cards.findIndex((c) => c.key === next.key);
  if (i === -1) return [...cards, next];
  const copy = cards.slice();
  copy[i] = next;
  return copy;
}

function applyDataPart(turn: Turn, name: string, partId: string | undefined, raw: unknown): Turn {
  const invalid = (): Turn => ({ ...turn, invalidParts: turn.invalidParts + 1 });
  const S = copilotDataPartSchemas;
  switch (name) {
    case "step": {
      const r = S.step.safeParse(raw);
      return r.success ? { ...turn, cards: upsert(turn.cards, { kind: "step", key: dataKey("step", partId, r.data.id), data: r.data }) } : invalid();
    }
    case "observation": {
      const r = S.observation.safeParse(raw);
      return r.success ? { ...turn, cards: upsert(turn.cards, { kind: "observation", key: dataKey("obs", partId, r.data.id), data: r.data }) } : invalid();
    }
    case "finding": {
      const r = S.finding.safeParse(raw);
      return r.success ? { ...turn, cards: upsert(turn.cards, { kind: "finding", key: dataKey("finding", partId, "main"), data: r.data }) } : invalid();
    }
    case "proposal": {
      const r = S.proposal.safeParse(raw);
      return r.success ? { ...turn, cards: upsert(turn.cards, { kind: "proposal", key: dataKey("proposal", partId, r.data.id), data: r.data }) } : invalid();
    }
    case "execution": {
      const r = S.execution.safeParse(raw);
      return r.success
        ? { ...turn, cards: upsert(turn.cards, { kind: "execution", key: dataKey("exec", partId, `${r.data.proposalId}:${r.data.step}`), data: r.data }) }
        : invalid();
    }
    case "verification": {
      const r = S.verification.safeParse(raw);
      return r.success
        ? { ...turn, cards: upsert(turn.cards, { kind: "verification", key: dataKey("verif", partId, r.data.proposalId), data: r.data }) }
        : invalid();
    }
    case "incident": {
      const r = S.incident.safeParse(raw);
      return r.success ? { ...turn, cards: upsert(turn.cards, { kind: "incident", key: dataKey("incident", partId, r.data.id), data: r.data }) } : invalid();
    }
    case "error": {
      const r = S.error.safeParse(raw);
      if (!r.success) return invalid();
      // The model being down is a degradation (rule-based findings follow), not a failed run.
      if (isDegradeCode(r.data.code)) return { ...turn, degraded: true };
      return { ...turn, cards: upsert(turn.cards, { kind: "error", key: dataKey("error", partId, `${turn.cards.length}`), data: r.data }) };
    }
    default:
      return turn;
  }
}

function abortTurnCards(turn: Turn): Turn {
  return {
    ...turn,
    status: "aborted",
    cards: turn.cards.map((c) =>
      c.kind === "step" && (c.data.status === "running" || c.data.status === "pending")
        ? { ...c, data: { ...c.data, status: "skipped" as const } }
        : c,
    ),
  };
}

/** The stream ended normally. A turn that received an error card ends as `error`. */
export function finishTurn(thread: Thread, turnId: string): Thread {
  const next = mapTurn(thread, turnId, (t) => {
    if (t.status === "aborted") return t;
    return { ...t, status: t.cards.some((c) => c.kind === "error") ? "error" : "done" };
  });
  const failed = next.turns.find((t) => t.id === turnId)?.status === "error";
  return { ...next, status: failed ? "error" : "idle", error: failed ? { code: "stream" } : undefined };
}

/** Transport failure (HTTP error, network loss, stalled stream) after zero or more chunks. */
export function failTurn(thread: Thread, turnId: string, error: ThreadError): Thread {
  const next = mapTurn(thread, turnId, (t) => ({
    ...t,
    status: "error",
    cards: t.cards.map((c) =>
      c.kind === "step" && c.data.status === "running" ? { ...c, data: { ...c.data, status: "failed" as const } } : c,
    ),
  }));
  return { ...next, status: "error", error };
}

export function abortTurn(thread: Thread, turnId: string): Thread {
  const next = mapTurn(thread, turnId, abortTurnCards);
  return { ...next, status: "idle", error: undefined };
}

/**
 * Applies an event from `GET /api/proposals/[id]/events` (or a refreshed proposal). It lands in the turn that
 * already holds the proposal card; without one it goes to the latest turn so nothing is lost.
 */
export function applyProposalEvent(thread: Thread, proposalId: string, chunk: unknown): Thread {
  const owner =
    thread.turns.find((t) => t.cards.some((c) => c.kind === "proposal" && c.data.id === proposalId)) ??
    thread.turns[thread.turns.length - 1];
  if (!owner) return thread;
  return applyChunk(thread, owner.id, chunk);
}

export function findProposal(thread: Thread, proposalId: string): Proposal | undefined {
  for (const t of thread.turns) {
    for (const c of t.cards) if (c.kind === "proposal" && c.data.id === proposalId) return c.data;
  }
  return undefined;
}

/** Proposals that still progress on the server: the panel re-attaches to their event stream after a remount. */
export function openProposalIds(thread: Thread): string[] {
  const ids: string[] = [];
  for (const t of thread.turns) {
    for (const c of t.cards) {
      if (c.kind === "proposal" && (c.data.status === "executing" || c.data.status === "verifying" || c.data.status === "approved")) {
        ids.push(c.data.id);
      }
    }
  }
  return ids;
}
