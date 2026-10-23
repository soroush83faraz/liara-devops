// SSE for one proposal: every `data:` frame is a contract CopilotStreamEvent JSON (`id:` = bus sequence for
// Last-Event-ID resumption), heartbeats are SSE comments, the stream ends on the terminal event, on client
// disconnect, or after maxDurationMs. Concurrent streams per account are capped.
import { TERMINAL_PROPOSAL_STATUSES, type Proposal } from "@/lib/contracts/proposal";
import type { CopilotDataStreamEvent } from "@/lib/contracts/stream";
import { subscribe, type BusEvent, type Subscription } from "../events";
import { processSingleton } from "../globals";
import { viewProposal } from "../view";
import type { Verification } from "@/lib/contracts/proposal";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

const TERMINAL = new Set<string>(TERMINAL_PROPOSAL_STATUSES);
export const MAX_STREAMS_PER_ACCOUNT = 8;
const TERMINAL_GRACE_MS = 2_000;

const streamCounts = () => processSingleton("sse-counts", () => new Map<string, number>());

/** Reserves a stream slot for the account; returns a release function or undefined when at the cap. */
export function reserveStream(accountId: string): (() => void) | undefined {
  const counts = streamCounts();
  const n = counts.get(accountId) ?? 0;
  if (n >= MAX_STREAMS_PER_ACCOUNT) return undefined;
  counts.set(accountId, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (counts.get(accountId) ?? 1) - 1;
    if (left <= 0) counts.delete(accountId);
    else counts.set(accountId, left);
  };
}

export interface ProposalStreamOptions {
  accountId: string;
  proposal: Proposal;
  /** Verification known from storage (e.g. the linked incident) for proposals finished before a restart. */
  storedVerification?: Verification;
  signal: AbortSignal;
  afterSeq?: number;
  heartbeatMs?: number;
  maxDurationMs?: number;
  onClose?: () => void;
}

export function proposalEventStream(opts: ProposalStreamOptions): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let sub: Subscription | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (maxTimer) clearTimeout(maxTimer);
    sub?.unsubscribe();
    opts.signal.removeEventListener("abort", close);
    try {
      controller?.close();
    } catch {
      // already closed by the consumer
    }
    opts.onClose?.();
  };
  const write = (chunk: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      close();
    }
  };
  const frame = (event: CopilotDataStreamEvent, seq?: number) => write(`${seq !== undefined ? `id: ${seq}\n` : ""}data: ${JSON.stringify(event)}\n\n`);
  const send = (be: BusEvent) => {
    frame(be.event, be.seq);
    if (be.terminal) close();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      if (opts.signal.aborted) return close();
      write("retry: 3000\n\n");
      sub = subscribe(opts.accountId, opts.proposal.id, send, { afterSeq: opts.afterSeq });
      for (const be of sub.replay) send(be);
      if (closed) return;
      if (sub.terminal) return close();
      opts.signal.addEventListener("abort", close, { once: true });
      if (TERMINAL.has(opts.proposal.status)) {
        // Stored as finished but no terminal event on the bus (finished before this process started, or the job
        // is publishing its last frames right now): give the job a moment, then send the stored outcome and end.
        maxTimer = setTimeout(
          () => {
            if (opts.storedVerification) {
              frame({ type: "data-verification", id: `verification:${opts.proposal.id}`, data: { proposalId: opts.proposal.id, result: opts.storedVerification } });
            }
            frame({ type: "data-proposal", id: `proposal:${opts.proposal.id}`, data: viewProposal(opts.proposal) });
            close();
          },
          sub.replay.length === 0 ? 0 : TERMINAL_GRACE_MS,
        );
        return;
      }
      heartbeat = setInterval(() => write(": hb\n\n"), opts.heartbeatMs ?? 15_000);
      maxTimer = setTimeout(close, opts.maxDurationMs ?? 30 * 60_000);
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
