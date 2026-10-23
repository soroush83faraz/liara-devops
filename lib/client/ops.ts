// Client helper for the human-initiated operations API (`POST /api/ops`, implemented by the actions unit).
// The same executors back AI proposals, but UI-originated ops skip the proposal step: the user's own click
// (plus the typed resource name for tier >= 2) is the approval. Never put secrets in logs or toasts.
import type { ActionParams } from "@/lib/contracts";

export interface OpRequest {
  params: ActionParams;
  /** Required by the server when ACTION_POLICY[type].requiresTypedName; must equal the target name. */
  typedName?: string;
  /** Secrets typed by the user for `valueSource: 'user'` env changes, keyed by env key. Sent once, never stored. */
  userValues?: Record<string, string>;
}

export interface OpSuccess {
  ok: true;
  type: string;
  target: { kind: string; name: string };
  /** Human-readable, secret-free summary of what happened. */
  summary: Record<string, unknown>;
  /** Optional read-back of the state after the operation. */
  after?: Record<string, unknown>;
  auditId?: string;
}

export class OpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "OpError";
  }
}

export async function runOp(req: OpRequest, signal?: AbortSignal): Promise<OpSuccess> {
  const res = await fetch("/api/ops", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  const body = (await res.json().catch(() => null)) as
    | OpSuccess
    | { error?: { code?: string; message?: string; retryAfterSec?: number } }
    | null;
  if (!res.ok || !body || !("ok" in body)) {
    const e = body && "error" in body ? body.error : undefined;
    throw new OpError(res.status, e?.code ?? "unknown", e?.message ?? "", e?.retryAfterSec);
  }
  return body;
}
