// LLM provider factory (server-only). Env-driven, lazy, primary + optional fallback. Also owns the failure
// taxonomy that drives degradation, the per-request budgets, and count-only usage logging.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError, type LanguageModel, type LanguageModelUsage } from "ai";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

/** Hard per-request budgets. Input is capped in characters before it reaches the provider. */
export const LLM_BUDGET = {
  maxInputChars: 24_000,
  toolLoop: { maxOutputTokens: 700, maxSteps: 4, maxToolCalls: 6, stepTimeoutMs: 25_000, totalTimeoutMs: 45_000, toolTimeoutMs: 15_000 },
  synthesis: { maxOutputTokens: 1_800, timeoutMs: 45_000 },
  explain: { maxOutputTokens: 600, timeoutMs: 25_000 },
} as const;
export const ROUTER_BUDGET = { maxInputChars: 1_000, maxOutputTokens: 40, timeoutMs: 6_000 } as const;

interface Endpoint {
  baseURL: string;
  apiKey: string;
  model: string;
}
export interface LlmConfig {
  primary: Endpoint;
  routerModel?: string;
  fallback?: Endpoint;
}

/** Only https endpoints (http allowed for localhost during development). The key never appears in errors. */
function cleanBaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return undefined;
    if (u.username || u.password) return undefined;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const modelOr = (v: string | undefined, d: string) => (v && MODEL_RE.test(v.trim()) ? v.trim() : d);

export function readLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const baseURL = cleanBaseUrl(env.LIARA_AI_BASE_URL);
  const apiKey = (env.LIARA_AI_API_KEY || env.LIARA_AI_KEY || "").trim();
  if (!baseURL || !apiKey) return null;
  const primary = { baseURL, apiKey, model: modelOr(env.LLM_MODEL, DEFAULT_MODEL) };
  const fbUrl = cleanBaseUrl(env.FALLBACK_AI_BASE_URL);
  const fbKey = (env.FALLBACK_AI_API_KEY || "").trim();
  const fbModel = env.FALLBACK_LLM_MODEL && MODEL_RE.test(env.FALLBACK_LLM_MODEL.trim()) ? env.FALLBACK_LLM_MODEL.trim() : undefined;
  const fallback = fbUrl && fbKey && fbModel ? { baseURL: fbUrl, apiKey: fbKey, model: fbModel } : undefined;
  const routerModel = env.LLM_ROUTER_MODEL && MODEL_RE.test(env.LLM_ROUTER_MODEL.trim()) ? env.LLM_ROUTER_MODEL.trim() : undefined;
  return { primary, ...(routerModel ? { routerModel } : {}), ...(fallback ? { fallback } : {}) };
}

export function isLlmConfigured(env?: Record<string, string | undefined>): boolean {
  return readLlmConfig(env) !== null;
}

export interface ModelHandle {
  model: LanguageModel;
  /** Model id for logs (never the key or URL). */
  id: string;
}
export interface AgentModels {
  primary: ModelHandle;
  fallback?: ModelHandle;
  router?: ModelHandle;
}

function chatModel(e: Endpoint, name: string, modelId = e.model): ModelHandle {
  // Liara's gateway exposes chat completions only (no /responses), hence the openai-compatible chat model.
  const provider = createOpenAICompatible({ name, baseURL: e.baseURL, apiKey: e.apiKey, includeUsage: true, supportsStructuredOutputs: true });
  return { model: provider.chatModel(modelId), id: modelId };
}

const CACHE_KEY = Symbol.for("hamyar.agent.models.v1");

/** Lazily builds (and caches per config) the provider handles. Returns null when no LLM is configured. */
export function getAgentModels(env: Record<string, string | undefined> = process.env): AgentModels | null {
  const cfg = readLlmConfig(env);
  if (!cfg) return null;
  const sig = [cfg.primary.baseURL, cfg.primary.model, cfg.routerModel, cfg.fallback?.baseURL, cfg.fallback?.model, cfg.primary.apiKey.length].join("|");
  const g = globalThis as unknown as Record<symbol, { sig: string; models: AgentModels } | undefined>;
  const cached = g[CACHE_KEY];
  if (cached && cached.sig === sig) return cached.models;
  const models: AgentModels = {
    primary: chatModel(cfg.primary, "liara"),
    ...(cfg.fallback ? { fallback: chatModel(cfg.fallback, "fallback") } : {}),
    ...(cfg.routerModel ? { router: chatModel(cfg.primary, "liara", cfg.routerModel) } : {}),
  };
  g[CACHE_KEY] = { sig, models };
  return models;
}

/* ------------------------------------------------------------ failures */

export const LLM_FAILURES = [
  "auth",
  "quota",
  "model_unavailable",
  "rate_limited",
  "timeout",
  "tools_unsupported",
  "structured_unsupported",
  "bad_output",
  "network",
  "server",
  "aborted",
  "unknown",
] as const;
export type LlmFailure = (typeof LLM_FAILURES)[number];

function bodyText(e: APICallError): string {
  const b = typeof e.responseBody === "string" ? e.responseBody : "";
  return `${b.slice(0, 2000)} ${e.message.slice(0, 500)}`.toLowerCase();
}

/** Maps any provider/SDK error onto a coarse class. Inspects the error body only for keywords, never logs it. */
export function classifyLlmError(error: unknown): LlmFailure {
  let e = error;
  if (RetryError.isInstance(e)) e = e.lastError;
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return e.name === "AbortError" ? "aborted" : "timeout";
  if (NoObjectGeneratedError.isInstance(e) || NoOutputGeneratedError.isInstance(e)) return "bad_output";
  if (e instanceof Error && /TypeValidationError|JSONParseError/.test(e.name)) return "bad_output";
  if (APICallError.isInstance(e)) {
    const s = e.statusCode ?? 0;
    const body = bodyText(e);
    const mentionsTools = /\btools?\b|tool_choice|function[_ ]call/.test(body);
    const mentionsFormat = /response_format|json_schema|structured/.test(body);
    if (s === 401) return "auth";
    if (s === 402 || /insufficient|quota|balance|credit|billing/.test(body)) return "quota";
    if (s === 403) return /model|plan|access/.test(body) ? "model_unavailable" : "auth";
    if (s === 404) return "model_unavailable";
    if (s === 429) return "rate_limited";
    if (s === 408 || s === 504) return "timeout";
    if (s === 400 || s === 422) {
      if (mentionsFormat) return "structured_unsupported";
      if (mentionsTools) return "tools_unsupported";
      if (/model/.test(body)) return "model_unavailable";
      return "unknown";
    }
    if (s >= 500) return "server";
    if (s === 0) return "network";
  }
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return "network";
  return "unknown";
}

export type DegradeMove = "retry_fallback" | "skip_tools" | "json_text" | "rule_only" | "abort";
export type LlmStage = "tools" | "synthesis" | "json" | "explain";

/** What to do after a failure in a given stage. One fallback retry at most, then rule-only. */
export function degradeMove(f: LlmFailure, stage: LlmStage, canFallback: boolean): DegradeMove {
  if (f === "aborted") return "abort";
  if (stage === "tools" && f === "tools_unsupported") return "skip_tools";
  if (stage === "synthesis" && (f === "structured_unsupported" || f === "bad_output")) return "json_text";
  if (stage === "tools" && (f === "bad_output" || f === "structured_unsupported")) return "skip_tools";
  return canFallback ? "retry_fallback" : "rule_only";
}

/* ---------------------------------------------------------------- usage */

/** Logs token counts only (never prompts, outputs, keys or URLs). */
export function logUsage(stage: string, modelId: string, usage: LanguageModelUsage | undefined): void {
  console.info("[agent] llm usage", { stage, model: modelId, input: usage?.inputTokens ?? null, output: usage?.outputTokens ?? null });
}

export function logFailure(stage: string, modelId: string, failure: LlmFailure): void {
  console.warn("[agent] llm failure", { stage, model: modelId, failure });
}
