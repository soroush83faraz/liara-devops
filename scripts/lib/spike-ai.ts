import { shapeOf, type Shape } from "./spike-shape";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}
export interface AiProbeResult {
  name: string;
  ok: boolean;
  status: number;
  detail: string;
  shape?: Shape;
}

const TOOLS = [{ type: "function", function: { name: "get_time", description: "current time", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
const JSON_SCHEMA = {
  type: "json_schema",
  json_schema: { name: "r", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } },
};

/**
 * Item 5: AI gateway probes (a handful of tiny billed requests). Only key names/types/status codes are recorded;
 * model output text is never stored.
 */
export async function probeAi(cfg: AiConfig, fetchImpl: typeof fetch = fetch): Promise<AiProbeResult[]> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" };
  const post = (body: Record<string, unknown>) =>
    fetchImpl(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: cfg.model, max_tokens: 32, ...body }), signal: AbortSignal.timeout(60_000) });
  const results: AiProbeResult[] = [];
  const run = async (name: string, fn: () => Promise<Omit<AiProbeResult, "name">>) => {
    try {
      results.push({ name, ...(await fn()) });
    } catch (e) {
      results.push({ name, ok: false, status: 0, detail: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network error" });
    }
  };
  const json = async (res: Response): Promise<unknown> => res.json().catch(() => null);
  const first = (body: unknown): Record<string, unknown> | undefined => {
    const choices = (body as { choices?: unknown } | null)?.choices;
    const c = Array.isArray(choices) ? choices[0] : undefined;
    const m = (c as { message?: unknown } | undefined)?.message;
    return m !== null && typeof m === "object" ? (m as Record<string, unknown>) : undefined;
  };

  await run("base URL form: GET /models", async () => {
    const res = await fetchImpl(`${base}/models`, { headers, signal: AbortSignal.timeout(30_000) });
    const body = await json(res);
    const data = (body as { data?: unknown } | null)?.data;
    return { ok: res.status === 200, status: res.status, detail: `endsWith /v1: ${/\/v1$/.test(base)}; models listed: ${Array.isArray(data) ? data.length : "n/a"}`, shape: shapeOf(body) };
  });
  await run("chat completion", async () => {
    const res = await post({ messages: [{ role: "user", content: "say ok" }] });
    const body = await json(res);
    return { ok: res.status === 200 && first(body) !== undefined, status: res.status, detail: "non-streaming", shape: shapeOf(body) };
  });
  await run("streaming (SSE)", async () => {
    const res = await post({ stream: true, max_tokens: 8, messages: [{ role: "user", content: "say ok" }] });
    const text = await res.text();
    const dataLines = text.split("\n").filter((l) => l.startsWith("data:")).length;
    return { ok: res.status === 200 && dataLines > 0, status: res.status, detail: `content-type ${(res.headers.get("content-type") ?? "").split(";")[0]}; data lines ${dataLines}; [DONE] ${text.includes("[DONE]")}` };
  });
  await run("tool call", async () => {
    const res = await post({ tools: TOOLS, tool_choice: "required", messages: [{ role: "user", content: "what time is it?" }] });
    const body = await json(res);
    const calls = first(body)?.tool_calls;
    const name = Array.isArray(calls) ? (calls[0] as { function?: { name?: unknown } } | undefined)?.function?.name : undefined;
    return { ok: res.status === 200 && name === "get_time", status: res.status, detail: `tool_calls returned: ${Array.isArray(calls) ? calls.length : 0}`, shape: shapeOf(first(body)) };
  });
  await run("json_schema output", async () => {
    const res = await post({ response_format: JSON_SCHEMA, messages: [{ role: "user", content: "reply with ok=true" }] });
    const body = await json(res);
    const content = first(body)?.content;
    let parsed = false;
    try {
      parsed = typeof content === "string" && typeof (JSON.parse(content) as { ok?: unknown }).ok === "boolean";
    } catch {
      parsed = false;
    }
    return { ok: res.status === 200 && parsed, status: res.status, detail: `content parsed as schema: ${parsed}` };
  });
  return results;
}
