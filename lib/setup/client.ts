"use client";
// Browser-side helpers for the setup wizard. Nothing here stores anything: env values the user types live in
// React state and are sent exactly once, in the body of the execute request.
//
// The proposal endpoints belong to the actions unit (U11). The contract assumed here (VERIFY when it lands):
//   POST /api/proposals/{id}/approve  { typedName }                 -> { approvalToken, expiresAt, proposal }
//   POST /api/proposals/{id}/execute  { approvalToken, userValues } -> 202 { proposalId, status }
//   GET  /api/proposals/{id}/events   SSE, each message = JSON CopilotStreamEvent
//        ({type:"data-execution"|"data-verification"|"data-error"|"data-proposal", data}).
import { CopilotStreamEventSchema, TERMINAL_PROPOSAL_STATUSES, type ProposalStatus, type StepStatus, type Verification } from "@/lib/contracts";
import type { Answers } from "./analyze";
import type { AnalyzeResponse, PlanResponse, QuestionsResponse } from "./api-types";
import type { PlanBody } from "./plan-request";

export class SetupApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "SetupApiError";
  }
}

async function asJson<T>(res: Response): Promise<T> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; field?: string; retryAfterSec?: number } } | null)?.error;
    throw new SetupApiError(res.status, e?.code ?? "unknown", e?.message ?? "", e?.field, e?.retryAfterSec);
  }
  return body as T;
}

const json = (url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

export async function analyzeFile(file: File, signal?: AbortSignal): Promise<AnalyzeResponse> {
  const form = new FormData();
  form.set("file", file);
  return asJson(await fetch("/api/setup/analyze", { method: "POST", body: form, signal }));
}

export async function fetchQuestions(signal?: AbortSignal): Promise<QuestionsResponse> {
  return asJson(await json("/api/setup/analyze", { description: "" }, signal));
}

export async function analyzeAnswers(answers: Answers, description: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  return asJson(await json("/api/setup/analyze", { answers, ...(description ? { description } : {}) }, signal));
}

export async function reanalyze(sourceRef: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  return asJson(await json("/api/setup/analyze", { sourceRef }, signal));
}

export async function requestPlan(body: PlanBody, signal?: AbortSignal): Promise<PlanResponse> {
  return asJson(await json("/api/setup/plan", body, signal));
}

/* ------------------------------------------------------ approve + execute */

export type RunEvent =
  | { kind: "phase"; phase: "approving" | "executing" }
  | { kind: "step"; step: string; status: StepStatus; detail?: string }
  | { kind: "verification"; result: Verification }
  | { kind: "error"; code: string; message: string }
  | { kind: "status"; status: ProposalStatus };

export interface RunOptions {
  proposalId: string;
  /** Must equal the app name (the server checks it again). */
  typedName: string;
  /** Values for `valueSource:'user'` env keys. Sent once in the execute body; never stored or logged. */
  userValues: Record<string, string>;
  onEvent: (e: RunEvent) => void;
  signal?: AbortSignal;
}

const TERMINAL = new Set<string>(TERMINAL_PROPOSAL_STATUSES);
const MAX_RUN_MS = 15 * 60_000;

/** Maps one SSE message to run events; returns true when the run is over. */
export function handleStreamMessage(raw: string, onEvent: (e: RunEvent) => void): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const ev = CopilotStreamEventSchema.safeParse(parsed);
  if (!ev.success) return false;
  const e = ev.data;
  switch (e.type) {
    case "data-execution":
      onEvent({ kind: "step", step: e.data.step, status: e.data.status, detail: e.data.detail });
      return false;
    case "data-verification":
      onEvent({ kind: "verification", result: e.data.result });
      return true;
    case "data-error":
      onEvent({ kind: "error", code: e.data.code, message: e.data.messageFa });
      return true;
    case "data-proposal":
      onEvent({ kind: "status", status: e.data.status });
      return TERMINAL.has(e.data.status);
    default:
      return false;
  }
}

export async function runProposal(opts: RunOptions): Promise<void> {
  const { proposalId, typedName, userValues, onEvent, signal } = opts;
  const base = `/api/proposals/${encodeURIComponent(proposalId)}`;

  onEvent({ kind: "phase", phase: "approving" });
  const approved = await asJson<{ approvalToken?: string }>(await json(`${base}/approve`, { typedName }, signal));
  const approvalToken = approved.approvalToken;
  if (!approvalToken) throw new SetupApiError(502, "approve_failed", "");

  onEvent({ kind: "phase", phase: "executing" });
  let finished = false;
  const done = new Promise<void>((resolve) => {
    const es = new EventSource(`${base}/events`);
    const timer = setTimeout(() => finish(), MAX_RUN_MS);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      es.close();
      resolve();
    };
    es.onmessage = (m: MessageEvent<string>) => {
      if (handleStreamMessage(m.data, onEvent)) finish();
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        onEvent({ kind: "error", code: "stream_lost", message: "" });
        finish();
      }
    };
    signal?.addEventListener("abort", finish, { once: true });
  });

  try {
    // Values travel only in this body. The server resolves them at execution time and never echoes them back.
    await asJson(await json(`${base}/execute`, { approvalToken, userValues }, signal));
  } catch (e) {
    finished = true;
    throw e;
  }
  await done;
}
