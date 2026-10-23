// HTTP handling for POST /api/agent, independent of the session layer so it can be tested directly.
// 4xx JSON only before streaming starts; afterwards every failure is a `data-error` part.
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { CopilotUIMessage } from "@/lib/contracts/stream";
import type { LiaraClient } from "@/lib/liara";
import { PolicyError, assertRateLimit } from "@/lib/security/policy";
import type { Store } from "@/lib/security/store";
import type { probeApp } from "@/lib/canvas/probe";
import { createEmitter } from "./emit";
import { ERROR_FA } from "./fa-messages";
import type { IncidentSink } from "./incident-port";
import { runAgent } from "./orchestrate";
import { getAgentModels, type AgentModels } from "./provider";
import { MAX_BODY_BYTES, parseAgentBody } from "./request";
import { acquireRun } from "./run-limits";

export const AGENT_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;
const KEEPALIVE_MS = 15_000;

export interface AgentHttpContext {
  session: { accountId: string; token: string };
  liara: LiaraClient;
  request: Request;
}
export interface AgentHttpOverrides {
  models?: AgentModels | null;
  store?: Pick<Store, "proposals">;
  incidents?: IncidentSink;
  probe?: typeof probeApp;
  now?: () => number;
}

const json = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  Response.json({ error: { code, message, ...extra } }, { status, headers: { "Cache-Control": "no-store" } });

async function readBody(request: Request): Promise<unknown | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES || !request.body) return undefined;
  // Read with a hard cap: a chunked body without content-length cannot exhaust memory.
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    parts.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    return undefined;
  }
}

export async function handleAgentPost(ctx: AgentHttpContext, o: AgentHttpOverrides = {}): Promise<Response> {
  const { session, request } = ctx;
  try {
    assertRateLimit(`agent:${session.accountId}`, AGENT_RATE_LIMIT.limit, AGENT_RATE_LIMIT.windowMs);
  } catch (e) {
    if (e instanceof PolicyError && e.code === "rate_limited") {
      return json(429, "rate_limited", ERROR_FA.rate_limited, { retryAfterSec: Math.ceil((e.retryAfterMs ?? 1000) / 1000) });
    }
    throw e;
  }
  const parsed = parseAgentBody(await readBody(request));
  if (!parsed) return json(400, "bad_request", ERROR_FA.bad_request);

  const release = acquireRun(session.accountId);
  if (!release) return json(429, "too_many_runs", ERROR_FA.too_many_runs, { retryAfterSec: 5 });

  const models = o.models !== undefined ? o.models : getAgentModels();
  const started = Date.now();
  const stream = createUIMessageStream<CopilotUIMessage>({
    execute: async ({ writer }) => {
      const emit = createEmitter((c) => writer.write(c));
      writer.write({ type: "start" });
      try {
        const summary = await runAgent(
          { accountId: session.accountId, text: parsed.text, history: parsed.history, ...(parsed.target ? { target: parsed.target } : {}) },
          {
            liara: ctx.liara,
            models,
            // SECURITY: the session token is scrubbed from everything (it never enters prompts anyway).
            knownSecrets: [session.token],
            ...(o.store ? { store: o.store } : {}),
            ...(o.incidents ? { incidents: o.incidents } : {}),
            ...(o.probe ? { probe: o.probe } : {}),
            ...(o.now ? { now: o.now } : {}),
            signal: request.signal,
          },
          emit,
        );
        // Counts and codes only: never user text, evidence or model output.
        console.info("[agent] run", { intent: summary.intent, kind: summary.target?.kind ?? null, degraded: summary.degraded, toolCalls: summary.toolCalls, proposal: Boolean(summary.proposalId), ms: Date.now() - started, textChars: parsed.text.length });
      } catch (e) {
        if (request.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
          console.info("[agent] run aborted");
        } else {
          console.error("[agent] run failed", e instanceof Error ? e.name : typeof e);
          emit.error("internal", ERROR_FA.internal);
        }
      } finally {
        release();
      }
      writer.write({ type: "finish" });
    },
    // Never forward error messages (they can echo upstream data).
    onError: () => "internal",
  });
  return createUIMessageStreamResponse({ stream, keepAliveMs: KEEPALIVE_MS, headers: { "Cache-Control": "no-store" } });
}
