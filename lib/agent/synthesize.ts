// PASS 2 (bounded read-only tool loop) and the structured synthesis call, with their degrade paths:
// tools unsupported -> skip the loop; structured output unsupported/invalid -> JSON-in-text parsed by zod;
// anything else -> one fallback retry, then the caller uses rule-only findings.
import { generateText, isStepCount, Output } from "ai";
import { z } from "zod";
import { CAUSES, type Cause } from "@/lib/evidence/levels";
import { buildSystemPrompt, JSON_FALLBACK_INSTRUCTIONS_FA, SYNTHESIS_INSTRUCTIONS_FA, TOOL_LOOP_INSTRUCTIONS_FA } from "./prompts.fa";
import { callWithFallback } from "./llm-call";
import { LLM_BUDGET, logUsage, type AgentModels, type LlmFailure } from "./provider";
import { buildTools, type ToolRuntime } from "./tools";

/** Strict schema sent as json_schema (every field required, no length keywords: widest gateway support). */
export const SynthesisSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        titleFa: z.string(),
        explanationFa: z.string(),
        supports: z.array(z.string()),
        contradicts: z.array(z.string()),
        cause: z.enum(CAUSES),
        actionHint: z.string().nullable(),
      }),
    )
    .max(5),
  summaryFa: z.string(),
  unknownsFa: z.array(z.string()),
});

export interface ModelHypothesis {
  titleFa: string;
  explanationFa: string;
  supports: string[];
  contradicts: string[];
  cause: Cause;
  actionHint?: string;
}
export interface ModelSynthesis {
  hypotheses: ModelHypothesis[];
  summaryFa: string;
  unknownsFa: string[];
}

const IdList = z.array(z.string().max(16)).max(20).catch([]);
const LenientHypothesis = z.object({
  titleFa: z.string().max(2_000),
  explanationFa: z.string().max(8_000),
  supports: IdList,
  contradicts: IdList.optional(),
  cause: z.enum(CAUSES),
  actionHint: z.string().max(40).nullable().optional().catch(undefined),
});

/** Parses whatever the model produced; malformed hypotheses are dropped individually. */
export function parseSynthesis(raw: unknown): ModelSynthesis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const hyps = Array.isArray(r.hypotheses) ? r.hypotheses.slice(0, 5) : [];
  const hypotheses: ModelHypothesis[] = [];
  for (const h of hyps) {
    const p = LenientHypothesis.safeParse(h);
    if (!p.success) continue;
    hypotheses.push({
      titleFa: p.data.titleFa,
      explanationFa: p.data.explanationFa,
      supports: p.data.supports,
      contradicts: p.data.contradicts ?? [],
      cause: p.data.cause,
      ...(p.data.actionHint ? { actionHint: p.data.actionHint } : {}),
    });
  }
  const summaryFa = typeof r.summaryFa === "string" ? r.summaryFa.slice(0, 4_000) : "";
  const unknownsFa = Array.isArray(r.unknownsFa) ? r.unknownsFa.filter((u): u is string => typeof u === "string").slice(0, 6) : [];
  if (hypotheses.length === 0 && !summaryFa) return null;
  return { hypotheses, summaryFa, unknownsFa };
}

/** First balanced top-level JSON object in a text (fences and prose around it are ignored). */
export function extractJsonObject(text: string): unknown {
  const s = text.slice(0, 60_000);
  const start = s.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export type Pass2Result = { status: "done"; calls: number } | { status: "skipped"; reason: "tools_unsupported" | "degraded"; failure?: LlmFailure } | { status: "aborted" };

export async function runToolLoop(models: AgentModels, digest: string, rt: ToolRuntime, signal?: AbortSignal): Promise<Pass2Result> {
  const B = LLM_BUDGET.toolLoop;
  const out = await callWithFallback(
    models,
    "tools",
    async (h) => {
      const r = await generateText({
        model: h.model,
        instructions: `${buildSystemPrompt()}\n\n${TOOL_LOOP_INSTRUCTIONS_FA}`,
        messages: [{ role: "user", content: digest }],
        tools: buildTools(rt),
        stopWhen: isStepCount(B.maxSteps),
        maxOutputTokens: B.maxOutputTokens,
        maxRetries: 0,
        timeout: { totalMs: B.totalTimeoutMs, stepMs: B.stepTimeoutMs },
        ...(signal ? { abortSignal: signal } : {}),
      });
      logUsage("tools", h.id, r.totalUsage);
      return r.steps.length;
    },
    signal,
  );
  if (out.ok) return { status: "done", calls: rt.calls };
  if (out.move === "abort") return { status: "aborted" };
  return { status: "skipped", reason: out.move === "skip_tools" ? "tools_unsupported" : "degraded", failure: out.failure };
}

export type SynthesisResult =
  | { ok: true; synthesis: ModelSynthesis; mode: "structured" | "json_text"; modelId: string }
  | { ok: false; failure: LlmFailure; aborted: boolean };

export async function synthesize(models: AgentModels, digest: string, signal?: AbortSignal): Promise<SynthesisResult> {
  const B = LLM_BUDGET.synthesis;
  const base = { maxOutputTokens: B.maxOutputTokens, maxRetries: 0, timeout: B.timeoutMs, ...(signal ? { abortSignal: signal } : {}) };
  const structured = await callWithFallback(
    models,
    "synthesis",
    async (h) => {
      const r = await generateText({
        ...base,
        model: h.model,
        instructions: `${buildSystemPrompt()}\n\n${SYNTHESIS_INSTRUCTIONS_FA}`,
        messages: [{ role: "user", content: digest }],
        output: Output.object({ schema: SynthesisSchema, name: "findings" }),
      });
      logUsage("synthesis", h.id, r.totalUsage);
      const parsed = parseSynthesis(r.output);
      if (!parsed) throw Object.assign(new Error("empty synthesis"), { name: "TypeValidationError" });
      return parsed;
    },
    signal,
  );
  if (structured.ok) return { ok: true, synthesis: structured.value, mode: "structured", modelId: structured.modelId };
  if (structured.move === "abort") return { ok: false, failure: "aborted", aborted: true };
  if (structured.move !== "json_text") return { ok: false, failure: structured.failure, aborted: false };

  // Structured output unsupported or invalid: ask for JSON in plain text and validate it ourselves.
  const json = await callWithFallback(
    models,
    "json",
    async (h) => {
      const r = await generateText({
        ...base,
        model: h.model,
        instructions: `${buildSystemPrompt()}\n\n${SYNTHESIS_INSTRUCTIONS_FA}\n${JSON_FALLBACK_INSTRUCTIONS_FA}`,
        messages: [{ role: "user", content: digest }],
      });
      logUsage("json", h.id, r.totalUsage);
      const parsed = parseSynthesis(extractJsonObject(r.text));
      if (!parsed) throw Object.assign(new Error("unparseable synthesis"), { name: "TypeValidationError" });
      return parsed;
    },
    signal,
  );
  if (json.ok) return { ok: true, synthesis: json.value, mode: "json_text", modelId: json.modelId };
  return { ok: false, failure: json.failure, aborted: json.move === "abort" };
}
