// Typed client for the proposal / incident / audit endpoints. Plain fetch on purpose: approval payloads (typed
// name, user-entered env values) must never pass through TanStack Query's caches. Nothing here logs request bodies.
import { AuditEntrySchema, IncidentSchema, ProposalSchema, type AuditEntry, type Incident, type Proposal } from "@/lib/contracts";
import { copilotFetch } from "./http";
import { ApiFailure, failureFromResponse, type FetchLike } from "./stream-client";
import { decodeChunk, readSse, SSE_DONE } from "./sse";

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" } as const;

async function requestJson(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchImpl(url, init);
  if (!res.ok) throw await failureFromResponse(res);
  try {
    return await res.json();
  } catch {
    throw new ApiFailure(502, "bad_json");
  }
}

/** Accepts `{proposal}` or a bare proposal. Returns undefined when the payload does not satisfy the contract. */
export function parseProposalPayload(body: unknown): Proposal | undefined {
  const candidate = body && typeof body === "object" && "proposal" in body ? (body as { proposal: unknown }).proposal : body;
  const r = ProposalSchema.safeParse(candidate);
  return r.success ? r.data : undefined;
}

export async function getProposal(id: string, fetchImpl: FetchLike = copilotFetch, signal?: AbortSignal): Promise<Proposal> {
  const body = await requestJson(fetchImpl, `/api/proposals/${encodeURIComponent(id)}`, { headers: { accept: "application/json" }, signal });
  const p = parseProposalPayload(body);
  if (!p) throw new ApiFailure(502, "bad_proposal");
  return p;
}

export interface ApprovalResult {
  approvalToken: string;
  expiresAt: string;
  proposal?: Proposal;
}

export async function approveProposal(id: string, input: { typedName?: string }, fetchImpl: FetchLike = copilotFetch): Promise<ApprovalResult> {
  const body = (await requestJson(fetchImpl, `/api/proposals/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input.typedName === undefined ? {} : { typedName: input.typedName }),
  })) as { approvalToken?: unknown; expiresAt?: unknown; proposal?: unknown };
  if (typeof body.approvalToken !== "string" || body.approvalToken.length === 0) throw new ApiFailure(502, "bad_token");
  return {
    approvalToken: body.approvalToken,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : "",
    proposal: parseProposalPayload(body),
  };
}

/**
 * `userValues` are sent exactly once in this request body. The caller drops its reference afterwards; this
 * function neither stores nor returns them.
 */
export async function executeProposal(
  id: string,
  input: { approvalToken: string; userValues?: Record<string, string> },
  fetchImpl: FetchLike = copilotFetch,
): Promise<void> {
  const payload: { approvalToken: string; userValues?: Record<string, string> } = { approvalToken: input.approvalToken };
  if (input.userValues && Object.keys(input.userValues).length > 0) payload.userValues = input.userValues;
  const res = await fetchImpl(`/api/proposals/${encodeURIComponent(id)}/execute`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (res.status !== 202 && !res.ok) throw await failureFromResponse(res);
}

export async function rejectProposal(id: string, fetchImpl: FetchLike = copilotFetch): Promise<Proposal | undefined> {
  const body = await requestJson(fetchImpl, `/api/proposals/${encodeURIComponent(id)}/reject`, { method: "POST", headers: JSON_HEADERS, body: "{}" });
  return parseProposalPayload(body);
}

/**
 * Follows `GET /api/proposals/[id]/events` and calls `onChunk` per decoded chunk. Resolves when the stream ends
 * (`[DONE]` or close), rejects on transport errors. Callers re-attach with `followProposalEvents`.
 */
export async function readProposalEvents(
  id: string,
  onChunk: (chunk: unknown) => void,
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<void> {
  const res = await (opts.fetchImpl ?? copilotFetch)(`/api/proposals/${encodeURIComponent(id)}/events`, {
    headers: { accept: "text/event-stream" },
    signal: opts.signal,
  });
  if (!res.ok) throw await failureFromResponse(res);
  if (!res.body) throw new ApiFailure(502, "empty_body");
  for await (const ev of readSse(res.body, { signal: opts.signal, idleTimeoutMs: 60_000 })) {
    const chunk = decodeChunk(ev);
    if (chunk === SSE_DONE) return;
    if (chunk !== null) onChunk(chunk);
  }
}

/** Lenient list/entity readers: the endpoints may return an array, or an object wrapping one. */
function pickArray(body: unknown, keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const k of keys) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export interface IncidentListItem {
  id: string;
  target: { kind: string; name: string };
  startedAt: string;
  resolvedAt?: string;
  outcome?: "verified" | "not_verified" | "failed";
  level?: "strong" | "medium" | "weak" | "insufficient";
  hasProposal: boolean;
}

const LEVELS = ["strong", "medium", "weak", "insufficient"] as const;
const OUTCOMES = ["verified", "not_verified", "failed"] as const;

/** Normalises list rows: full Incidents, or summaries with `outcome` / `level` fields. Invalid rows are skipped. */
export function normalizeIncidentList(body: unknown): IncidentListItem[] {
  const rows = pickArray(body, ["incidents", "items", "data"]);
  const out: IncidentListItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const target = r.target as { kind?: unknown; name?: unknown } | undefined;
    if (typeof r.id !== "string" || typeof r.startedAt !== "string" || !target || typeof target.kind !== "string" || typeof target.name !== "string") continue;
    const verification = r.verification as { outcome?: unknown } | undefined;
    const finding = r.finding as { hypotheses?: Array<{ level?: unknown }> } | undefined;
    const rawOutcome = typeof r.outcome === "string" ? r.outcome : verification?.outcome;
    const rawLevel = typeof r.level === "string" ? r.level : finding?.hypotheses?.[0]?.level;
    out.push({
      id: r.id,
      target: { kind: target.kind, name: target.name },
      startedAt: r.startedAt,
      resolvedAt: typeof r.resolvedAt === "string" ? r.resolvedAt : undefined,
      outcome: OUTCOMES.find((o) => o === rawOutcome),
      level: LEVELS.find((l) => l === rawLevel),
      hasProposal: typeof r.proposalId === "string",
    });
  }
  return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export async function listIncidents(fetchImpl: FetchLike = copilotFetch, signal?: AbortSignal): Promise<IncidentListItem[]> {
  return normalizeIncidentList(await requestJson(fetchImpl, "/api/incidents", { headers: { accept: "application/json" }, signal }));
}

export async function getIncident(id: string, fetchImpl: FetchLike = copilotFetch, signal?: AbortSignal): Promise<Incident> {
  const body = await requestJson(fetchImpl, `/api/incidents/${encodeURIComponent(id)}`, { headers: { accept: "application/json" }, signal });
  const candidate = body && typeof body === "object" && "incident" in body ? (body as { incident: unknown }).incident : body;
  const r = IncidentSchema.safeParse(candidate);
  if (!r.success) throw new ApiFailure(502, "bad_incident");
  return r.data;
}

/** Markdown export: plain text, or JSON `{markdown}`. */
export async function getIncidentMarkdown(id: string, fetchImpl: FetchLike = copilotFetch): Promise<string> {
  const res = await fetchImpl(`/api/incidents/${encodeURIComponent(id)}/markdown`, { headers: { accept: "text/markdown, application/json" } });
  if (!res.ok) throw await failureFromResponse(res);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await res.json()) as { markdown?: unknown };
    if (typeof body.markdown !== "string") throw new ApiFailure(502, "bad_markdown");
    return body.markdown;
  }
  return res.text();
}

export const AUDIT_DEFAULT_LIMIT = 100;

/** Audit entries exactly as given (the server has already redacted them); invalid rows are skipped. */
export function normalizeAudit(body: unknown): AuditEntry[] {
  const rows = pickArray(body, ["entries", "items", "audit", "data"]);
  const out: AuditEntry[] = [];
  for (const row of rows) {
    const r = AuditEntrySchema.safeParse(row);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

export async function listAudit(limit = AUDIT_DEFAULT_LIMIT, fetchImpl: FetchLike = copilotFetch, signal?: AbortSignal): Promise<AuditEntry[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.round(limit)));
  return normalizeAudit(await requestJson(fetchImpl, `/api/audit?limit=${safeLimit}`, { headers: { accept: "application/json" }, signal }));
}
