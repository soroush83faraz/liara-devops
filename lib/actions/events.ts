// In-process, per-proposal event bus feeding the SSE route. Every event is a contract CopilotStreamEvent
// (validated before it is stored), keyed by account + proposal so one account can never read another's.
// Late subscribers get a compacted replay (latest event per part id); nothing is published after the
// terminal event. Process-wide via globalThis (route bundles must share one bus).
import { CopilotStreamEventSchema, type CopilotDataStreamEvent, type StepStatus } from "@/lib/contracts/stream";
import type { Proposal, Verification } from "@/lib/contracts/proposal";
import { processSingleton } from "./globals";
import { safeLog } from "./log";
import { viewProposal } from "./view";

export interface BusEvent {
  seq: number;
  event: CopilotDataStreamEvent;
  terminal: boolean;
}
type Listener = (e: BusEvent) => void;

interface Channel {
  events: BusEvent[];
  listeners: Set<Listener>;
  seq: number;
  terminal: boolean;
  touchedAt: number;
}

const MAX_EVENTS_PER_CHANNEL = 200;
const MAX_CHANNELS = 1000;
const TERMINAL_TTL_MS = 30 * 60_000;

const channels = () => processSingleton("proposal-bus", () => new Map<string, Channel>());
const keyOf = (accountId: string, proposalId: string) => `${accountId}\u0000${proposalId}`;

function gc(now: number): void {
  const map = channels();
  for (const [k, ch] of map) if (ch.terminal && ch.listeners.size === 0 && now - ch.touchedAt > TERMINAL_TTL_MS) map.delete(k);
  if (map.size <= MAX_CHANNELS) return;
  const idle = [...map].filter(([, ch]) => ch.listeners.size === 0).sort((a, b) => a[1].touchedAt - b[1].touchedAt);
  for (const [k] of idle) {
    if (map.size <= MAX_CHANNELS) break;
    map.delete(k);
  }
}

function channel(key: string): Channel {
  const map = channels();
  let ch = map.get(key);
  if (!ch) {
    ch = { events: [], listeners: new Set(), seq: 0, terminal: false, touchedAt: Date.now() };
    map.set(key, ch);
  }
  return ch;
}

/** Publishes one data part. Off-contract events are dropped (never forwarded to the browser). */
export function publish(accountId: string, proposalId: string, event: CopilotDataStreamEvent, opts: { terminal?: boolean } = {}): void {
  const parsed = CopilotStreamEventSchema.safeParse(event);
  if (!parsed.success || parsed.data.type === "text-delta") return;
  const ch = channel(keyOf(accountId, proposalId));
  if (ch.terminal) return;
  const be: BusEvent = { seq: ++ch.seq, event: parsed.data, terminal: Boolean(opts.terminal) };
  const id = parsed.data.id;
  if (id !== undefined) {
    const i = ch.events.findIndex((x) => x.event.id === id);
    if (i >= 0) ch.events.splice(i, 1);
  }
  ch.events.push(be);
  if (ch.events.length > MAX_EVENTS_PER_CHANNEL) ch.events.shift();
  if (be.terminal) ch.terminal = true;
  ch.touchedAt = Date.now();
  for (const listener of [...ch.listeners]) {
    try {
      listener(be);
    } catch (e) {
      safeLog("bus_listener_failed", e);
    }
  }
  gc(ch.touchedAt);
}

export interface Subscription {
  replay: BusEvent[];
  terminal: boolean;
  unsubscribe: () => void;
}

/** Replays events with seq > afterSeq (Last-Event-ID), then delivers new ones to `listener`. */
export function subscribe(accountId: string, proposalId: string, listener: Listener, opts: { afterSeq?: number } = {}): Subscription {
  const ch = channel(keyOf(accountId, proposalId));
  const after = opts.afterSeq ?? 0;
  ch.listeners.add(listener);
  return {
    replay: ch.events.filter((e) => e.seq > after),
    terminal: ch.terminal,
    unsubscribe: () => {
      ch.listeners.delete(listener);
    },
  };
}

export function hasEvents(accountId: string, proposalId: string): boolean {
  return (channels().get(keyOf(accountId, proposalId))?.events.length ?? 0) > 0;
}

/* --------------------------------------------------------------- helpers */

export function publishExecution(accountId: string, proposalId: string, step: string, status: StepStatus, detail?: string): void {
  publish(accountId, proposalId, {
    type: "data-execution",
    id: `exec:${step}`,
    data: { proposalId, step, status, ...(detail ? { detail: detail.slice(0, 500) } : {}) },
  });
}

export function publishVerification(accountId: string, proposalId: string, result: Verification): void {
  publish(accountId, proposalId, { type: "data-verification", id: `verification:${proposalId}`, data: { proposalId, result } });
}

export function publishProposal(accountId: string, proposal: Proposal, terminal = false): void {
  publish(accountId, proposal.id, { type: "data-proposal", id: `proposal:${proposal.id}`, data: viewProposal(proposal) }, { terminal });
}

export function publishError(accountId: string, proposalId: string, code: string, messageFa: string): void {
  publish(accountId, proposalId, { type: "data-error", id: `error:${proposalId}`, data: { code, messageFa } });
}
