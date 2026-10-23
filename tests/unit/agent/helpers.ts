// Agent test doubles: a fake Liara backend over the synthetic scenarios (records every method so tests can
// assert that nothing mutating is ever sent) and a scripted mock LLM built on the AI SDK's MockLanguageModelV4.
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { createLiaraClient, type LiaraClient } from "@/lib/liara";
import type { CopilotUIMessageChunk } from "@/lib/contracts/stream";
import { createEmitter, type Emitter } from "@/lib/agent/emit";
import type { AgentModels } from "@/lib/agent/provider";
import { JSON_FALLBACK_INSTRUCTIONS_FA, ROUTER_INSTRUCTIONS_FA, SYNTHESIS_INSTRUCTIONS_FA, TOOL_LOOP_INSTRUCTIONS_FA } from "@/lib/agent/prompts.fa";
import { loadScenario, pageBuildLogs, type Scenario } from "../evidence/helpers";

export { loadScenario, SCENARIOS, TEST_TOKEN, fakeProbe, nowOf } from "../evidence/helpers";

type Route = { key: string; re: RegExp; body: (s: Scenario, m: RegExpMatchArray, q: URLSearchParams) => unknown };

const ROUTES: Route[] = [
  { key: "apps", re: /^\/v1\/projects$/, body: (s) => ({ projects: [{ _id: "p1", project_id: s.name, type: "node", status: "RUNNING", scale: 1 }, { _id: "p2", project_id: "other-app", type: "node", scale: 1 }] }) },
  { key: "logs", re: /^\/v2\/projects\/[^/]+\/logs$/, body: (s) => s.logs },
  { key: "logsV1", re: /^\/v1\/projects\/[^/]+\/logs$/, body: () => undefined },
  { key: "applets", re: /^\/v1\/projects\/[^/]+\/applets$/, body: (s) => s.applets },
  { key: "releases", re: /^\/v1\/projects\/[^/]+\/releases$/, body: (s) => s.releases },
  { key: "events", re: /^\/v1\/projects\/[^/]+\/events$/, body: (s) => s.events },
  { key: "metricsSummary", re: /^\/v1\/projects\/[^/]+\/metrics\/summary$/, body: (s) => s.metricsSummary },
  { key: "metricsCpu", re: /^\/v1\/projects\/[^/]+\/metrics\/cpu$/, body: (s) => s.metricsCpu },
  { key: "metricsMemory", re: /^\/v1\/projects\/[^/]+\/metrics\/memory$/, body: (s) => s.metricsMemory },
  { key: "app", re: /^\/v1\/projects\/[^/]+$/, body: (s) => s.app },
  { key: "releaseDetail", re: /^\/v1\/releases\/([^/]+)$/, body: (s, m) => s.releaseDetails[m[1]] },
  { key: "buildLogs", re: /^\/v2\/releases\/([^/]+)\/build-logs$/, body: (s, m, q) => pageBuildLogs(s.buildLogs[m[1]], q.get("since")) },
  { key: "me", re: /^\/v1\/me$/, body: (s) => s.me },
  { key: "databases", re: /^\/v1\/databases$/, body: (s) => s.databases },
  { key: "dbMetricsSummary", re: /^\/v1\/databases\/[^/]+\/metrics\/summary$/, body: (s) => s.dbMetricsSummary },
  { key: "dbEvents", re: /^\/v1\/databases\/[^/]+\/events$/, body: (s) => s.dbEvents },
  {
    key: "databaseDetail",
    re: /^\/v1\/databases\/([^/]+)$/,
    body: (s, m) => {
      if (s.databaseDetails[m[1]]) return s.databaseDetails[m[1]];
      // Fingerprinting looks a database up by hostname: map it back to the detail by hostname.
      return Object.values(s.databaseDetails).find((d) => JSON.stringify(d).includes(`"hostname":"${m[1]}"`));
    },
  },
];

export interface AgentBackend {
  client: LiaraClient;
  calls: string[];
  /** Every non-GET request that reached the network layer (must stay empty). */
  mutations: string[];
}

export function agentLiara(s: Scenario, overrides: Record<string, number> = {}, patch: Partial<Scenario> = {}): AgentBackend {
  const scen = { ...s, ...patch };
  const calls: string[] = [];
  const mutations: string[] = [];
  const fail = { ...scen.fail, ...overrides };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = decodeURIComponent(url.pathname);
    calls.push(`${method} ${path}`);
    if (method !== "GET") {
      mutations.push(`${method} ${path}`);
      return new Response("{}", { status: 405 });
    }
    for (const r of ROUTES) {
      const m = path.match(r.re);
      if (!m) continue;
      if (fail[r.key]) return new Response(JSON.stringify({ message: "synthetic failure" }), { status: fail[r.key] });
      const body = r.body(scen, m, url.searchParams);
      if (body === undefined) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { client: createLiaraClient({ token: "synthetic-test-token-XYZ123456", fetchImpl, retries: 0, timeoutMs: 2000 }), calls, mutations };
}

/* ------------------------------------------------------------ mock LLM */

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } };
export const textResult = (text: string): LanguageModelV4GenerateResult => ({ content: [{ type: "text", text }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] });
let callSeq = 0;
export const toolCallResult = (toolName: string, input: unknown): LanguageModelV4GenerateResult => ({
  content: [{ type: "tool-call", toolCallId: `call_${++callSeq}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls", raw: undefined },
  usage,
  warnings: [],
});

export type Stage = "router" | "tools" | "synthesis" | "json" | "explain";

export interface StageCall {
  stage: Stage;
  /** The user-side content the model saw (digest). */
  prompt: string;
  /** Tool names offered in this call. */
  tools: string[];
  /** Index of this call within its stage. */
  n: number;
  /** Tool results already in the conversation (for loop scripts). */
  toolResults: unknown[];
}

export type Script = Partial<Record<Stage, (c: StageCall) => LanguageModelV4GenerateResult | Promise<LanguageModelV4GenerateResult>>>;

function systemText(opts: LanguageModelV4CallOptions): string {
  return opts.prompt.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
}

function stageOf(opts: LanguageModelV4CallOptions): Stage {
  const sys = systemText(opts);
  if (sys.includes(ROUTER_INSTRUCTIONS_FA.slice(0, 30))) return "router";
  if (sys.includes(JSON_FALLBACK_INSTRUCTIONS_FA.slice(0, 30))) return "json";
  if (sys.includes(SYNTHESIS_INSTRUCTIONS_FA.slice(0, 30))) return "synthesis";
  if (sys.includes(TOOL_LOOP_INSTRUCTIONS_FA.slice(0, 30))) return "tools";
  return "explain";
}

export interface MockLlm {
  models: AgentModels;
  calls: StageCall[];
}

/** Scripted fake LLM: each stage answers from the script; unscripted stages return a plain "done". */
export function mockLlm(script: Script, opts: { fallback?: Script; withRouter?: boolean } = {}): MockLlm {
  const calls: StageCall[] = [];
  const make = (sc: Script, id: string) =>
    new MockLanguageModelV4({
      modelId: id,
      doGenerate: async (o) => {
        const stage = stageOf(o);
        const prompt = o.prompt
          .filter((m) => m.role === "user")
          .map((m) => (Array.isArray(m.content) ? m.content.map((p) => (p.type === "text" ? p.text : "")).join("") : ""))
          .join("\n");
        const toolResults = o.prompt.filter((m) => m.role === "tool").flatMap((m) => m.content.map((p) => (p.type === "tool-result" ? p.output : undefined)));
        const call: StageCall = { stage, prompt, tools: (o.tools ?? []).map((t) => t.name), n: calls.filter((c) => c.stage === stage).length, toolResults };
        calls.push(call);
        const fn = sc[stage];
        return fn ? fn(call) : textResult("done");
      },
    });
  const models: AgentModels = {
    primary: { model: make(script, "mock-primary"), id: "mock-primary" },
    ...(opts.fallback ? { fallback: { model: make(opts.fallback, "mock-fallback"), id: "mock-fallback" } } : {}),
    ...(opts.withRouter ? { router: { model: make(script, "mock-router"), id: "mock-router" } } : {}),
  };
  return { models, calls };
}

export const apiError = (statusCode: number, responseBody = "{}") =>
  new APICallError({ message: `status ${statusCode}`, url: "https://ai.example.invalid/v1/chat/completions", requestBodyValues: {}, statusCode, responseBody, isRetryable: false });

/* ------------------------------------------------------------ stream capture */

export interface Captured {
  emit: Emitter;
  chunks: CopilotUIMessageChunk[];
  data: Array<{ type: string; id?: string; data: Record<string, unknown> }>;
  text: () => string;
}

export function capture(): Captured {
  const chunks: CopilotUIMessageChunk[] = [];
  const emit = createEmitter((c) => chunks.push(c));
  return {
    emit,
    chunks,
    get data() {
      return chunks.filter((c) => c.type.startsWith("data-")) as unknown as Captured["data"];
    },
    text: () => chunks.flatMap((c) => (c.type === "text-delta" ? [c.delta] : [])).join(""),
  };
}

export const dataOf = (c: Captured, type: string) => c.data.filter((d) => d.type === type);

/** Parses an SSE body produced by createUIMessageStreamResponse into chunks. */
export function parseSse(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}

export { loadScenario as scenario };
