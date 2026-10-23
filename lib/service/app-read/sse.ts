// Server-Sent Events helpers: encoder, heartbeat, max-duration and abort clean-up in one place.
import { isLiaraError } from "../../liara";
import { fa } from "../../i18n/fa";
import type { StreamErrorEvent } from "./types";

export const HEARTBEAT_COMMENT = ": hb\n\n";

const encoder = new TextEncoder();

/** One SSE frame. `data` is JSON; newlines in JSON are impossible, so a single `data:` line is enough. */
export function encodeSseEvent(data: unknown, opts: { event?: string; id?: string; retryMs?: number } = {}): string {
  let out = "";
  if (opts.retryMs !== undefined) out += `retry: ${Math.max(0, Math.floor(opts.retryMs))}\n`;
  if (opts.id) out += `id: ${opts.id.replace(/[\r\n]/g, " ")}\n`;
  if (opts.event) out += `event: ${opts.event.replace(/[\r\n]/g, " ")}\n`;
  out += `data: ${JSON.stringify(data)}\n\n`;
  return out;
}

/** Safe, user-facing error payload for a failure inside an already-open stream (never includes raw bodies). */
export function toStreamError(error: unknown): StreamErrorEvent {
  if (isLiaraError(error)) {
    switch (error.kind) {
      case "auth":
        return { kind: "error", code: "liara_auth", message: fa.errors.unauthorized, fatal: true };
      case "forbidden":
        return { kind: "error", code: "forbidden", message: fa.errors.forbidden, fatal: true };
      case "not_found":
        return { kind: "error", code: "not_found", message: fa.errors.notFound, fatal: true };
      case "rate_limited":
        return { kind: "error", code: "rate_limited", message: fa.errors.rateLimited };
      case "timeout":
        return { kind: "error", code: "liara_timeout", message: fa.errors.liaraTimeout };
      default:
        return { kind: "error", code: "liara_unavailable", message: fa.errors.liaraUnavailable };
    }
  }
  return { kind: "error", code: "internal", message: fa.errors.generic };
}

export interface SseContext {
  /** Returns false once the stream is closed. */
  send: (data: unknown, opts?: { event?: string; id?: string }) => boolean;
  /** Aborts on client disconnect, max duration, or `close()`. */
  signal: AbortSignal;
}

export interface SseOptions {
  /** The incoming request's signal (client disconnect). */
  signal?: AbortSignal;
  heartbeatMs?: number;
  maxDurationMs?: number;
  run: (ctx: SseContext) => Promise<void>;
  /** Called exactly once when the stream ends for any reason (release counters etc.). */
  onClose?: () => void;
  /** Frame sent right before closing at `maxDurationMs`, so clients can reconnect without guessing. */
  endEvent?: unknown;
  /** Sent as the last frame when `run` throws. Defaults to `toStreamError`. */
  mapError?: (error: unknown) => unknown;
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/**
 * Builds a streaming `Response`. Cleans up on client abort, on max duration and when `run` settles:
 * timers are cleared, the controller closed and `onClose` called once.
 */
export function sseResponse(opts: SseOptions): Response {
  const { heartbeatMs = 15_000, maxDurationMs = 15 * 60_000 } = opts;
  const ac = new AbortController();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

  const finish = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (maxTimer) clearTimeout(maxTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    ac.abort();
    try {
      ctrl?.close();
    } catch {
      /* already closed by the consumer */
    }
    try {
      opts.onClose?.();
    } catch {
      /* clean-up must never throw into the stream */
    }
  };
  const onAbort = () => finish();

  const write = (chunk: string): boolean => {
    if (closed || !ctrl) return false;
    try {
      ctrl.enqueue(encoder.encode(chunk));
      return true;
    } catch {
      finish();
      return false;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      if (opts.signal?.aborted) return finish();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      write(encodeSseEvent({ kind: "hello" }, { event: "hello", retryMs: 3000 }));
      heartbeat = setInterval(() => write(HEARTBEAT_COMMENT), heartbeatMs);
      maxTimer = setTimeout(() => {
        if (opts.endEvent !== undefined) write(encodeSseEvent(opts.endEvent));
        finish();
      }, maxDurationMs);
      const ctx: SseContext = { send: (data, o) => write(encodeSseEvent(data, o)), signal: ac.signal };
      opts
        .run(ctx)
        .catch((error: unknown) => {
          if (!ac.signal.aborted) write(encodeSseEvent((opts.mapError ?? toStreamError)(error)));
        })
        .finally(finish);
    },
    cancel() {
      finish();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
