// Client for POST /api/agent (AI SDK UI message stream) and the wire-message builder. No React.
import type { TargetKind } from "@/lib/contracts";
import { decodeChunk, readSse, SSE_DONE } from "./sse";
import type { Thread } from "./thread";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AgentTarget {
  kind: Extract<TargetKind, "app" | "db">;
  name: string;
}

export const targetKey = (t: AgentTarget): string => `${t.kind}:${t.name}`;

export interface WireMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

export const MAX_WIRE_MESSAGES = 20;
export const MAX_WIRE_TEXT = 4_000;

/**
 * History sent to the server: user text and the assistant's prose only (never cards, never observations).
 * The server re-collects evidence itself; this keeps the request small and free of anything we displayed.
 */
export function toWireMessages(thread: Pick<Thread, "turns">, nextUserText?: string): WireMessage[] {
  const out: WireMessage[] = [];
  for (const t of thread.turns) {
    if (t.userText) out.push({ id: `${t.id}-u`, role: "user", parts: [{ type: "text", text: t.userText.slice(0, MAX_WIRE_TEXT) }] });
    const prose = t.cards
      .filter((c): c is Extract<typeof c, { kind: "text" }> => c.kind === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (prose) out.push({ id: `${t.id}-a`, role: "assistant", parts: [{ type: "text", text: prose.slice(0, MAX_WIRE_TEXT) }] });
  }
  if (nextUserText !== undefined) {
    out.push({ id: `next-u`, role: "user", parts: [{ type: "text", text: nextUserText.slice(0, MAX_WIRE_TEXT) }] });
  }
  return out.slice(-MAX_WIRE_MESSAGES);
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSec?: number,
  ) {
    super(`api ${status} ${code}`);
    this.name = "ApiFailure";
  }
}

/** Reads `{error:{code,message,retryAfterSec}}` (and Retry-After) without ever echoing the body into the UI. */
export async function failureFromResponse(res: Response): Promise<ApiFailure> {
  let code = "unknown";
  let retry: number | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: unknown; retryAfterSec?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code.slice(0, 80);
    if (typeof body.error?.retryAfterSec === "number") retry = body.error.retryAfterSec;
  } catch {
    // non-JSON error body
  }
  if (retry === undefined) {
    const header = Number(res.headers.get("retry-after"));
    if (Number.isFinite(header) && header > 0) retry = Math.min(3600, Math.round(header));
  }
  return new ApiFailure(res.status, code, retry);
}

export const STREAM_IDLE_TIMEOUT_MS = 90_000;

/** Streams decoded UI-message chunks. Throws ApiFailure for HTTP errors; network errors propagate as-is. */
export async function* streamAgent(args: {
  fetchImpl: FetchLike;
  target: AgentTarget;
  messages: WireMessage[];
  signal?: AbortSignal;
  idleTimeoutMs?: number;
}): AsyncGenerator<unknown> {
  const res = await args.fetchImpl("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ messages: args.messages, target: args.target }),
    signal: args.signal,
  });
  if (!res.ok) throw await failureFromResponse(res);
  if (!res.body) throw new ApiFailure(502, "empty_body");
  for await (const ev of readSse(res.body, { signal: args.signal, idleTimeoutMs: args.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS })) {
    const chunk = decodeChunk(ev);
    if (chunk === SSE_DONE) return;
    if (chunk !== null) yield chunk;
  }
}

export type ErrorKind =
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "rateLimited"
  | "timeout"
  | "server"
  | "network"
  | "stream"
  | "invalid"
  | "generic";

/** Maps a transport/HTTP failure onto one of the plan's error states (§4 States). */
export function classifyFailure(err: unknown): { kind: ErrorKind; status?: number; code: string; retryAfterSec?: number } {
  if (err instanceof ApiFailure) {
    const { status, code, retryAfterSec } = err;
    if (status === 401) return { kind: "unauthorized", status, code };
    if (status === 403) return { kind: "forbidden", status, code };
    if (status === 404) return { kind: "notFound", status, code };
    if (status === 409) return { kind: "conflict", status, code };
    if (status === 429) return { kind: "rateLimited", status, code, retryAfterSec };
    if (status === 400 || status === 422) return { kind: "invalid", status, code };
    if (status === 408 || status === 504) return { kind: "timeout", status, code };
    if (status >= 500) return { kind: "server", status, code };
    return { kind: "generic", status, code };
  }
  if (err instanceof Error && err.name === "StreamStalledError") return { kind: "stream", code: "stalled" };
  if (err instanceof TypeError) return { kind: "network", code: "network" };
  return { kind: "generic", code: "unknown" };
}
