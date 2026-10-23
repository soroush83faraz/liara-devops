// Deterministic-first intent routing. Keywords decide whenever they can; an optional cheap LLM call with a
// strict enum schema only breaks ties for text that matched nothing. Refusals never depend on the model.
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { INTENT_PATTERNS_FA, ROUTER_INSTRUCTIONS_FA } from "./prompts.fa";
import { ROUTER_BUDGET } from "./provider";

export const INTENTS = ["diagnose", "status", "explain", "action_request", "setup_redirect", "refuse", "clarify"] as const;
export type Intent = (typeof INTENTS)[number];

export type RequestedAction = "restart" | "start" | "stop" | "resize" | "set_env" | "update_port";
export type RefuseReason = "destructive" | "shell" | "cross_app";

export interface IntentResult {
  intent: Intent;
  source: "rules" | "llm" | "default";
  requested?: RequestedAction;
  refuse?: RefuseReason;
}

/** Folds Persian/Arabic variants and digits so one pattern covers common spellings. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u200C\u200D\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const EN = {
  destructive: /\b(?:delete|remove|drop|destroy|wipe|erase|purge|truncate)\b/,
  shell: /\brm\s+-|\b(?:shell|ssh|bash|sudo|terminal|exec|chmod|curl\s.*\|\s*sh)\b|\brun (?:a |the |this )?(?:command|script)\b|\bexecute (?:a |the |this )?(?:command|script)\b/,
  setup: /\b(?:deploy (?:my|a|new)|new (?:app|project)|create (?:an? )?(?:app|project|database)|set ?up (?:my|a) (?:app|project))\b/,
  restart: /\b(?:restart|reboot|reload)\b/,
  start: /\b(?:start|turn on|power on|scale up)\b/,
  stop: /\b(?:stop|turn off|shut ?down|scale down)\b/,
  resize: /\b(?:resize|upgrade|bigger plan|more (?:ram|memory|cpu))\b/,
  setEnv: /\b(?:set|add|update) (?:the )?(?:env|environment variable|variable)\b/,
  port: /\b(?:set|change|update) (?:the )?port\b/,
  diagnose: /\b(?:error|errors|5\d\d|4\d\d|broken|down|crash|crashing|fail|failing|failed|slow|timeout|not working|why|bug|issue|problem|logs?)\b/,
  status: /\b(?:status|health|healthy|running|usage|how is)\b/,
  explain: /\b(?:what is|what's|explain|meaning|difference)\b/,
};

const has = (t: string, key: keyof typeof EN) => EN[key].test(t) || (INTENT_PATTERNS_FA as Record<string, RegExp>)[key]?.test(t) === true;

/** Pure keyword routing. Returns `clarify` with source `default` when nothing matched. */
export function routeIntentRules(text: string): IntentResult {
  const t = normalizeText(text);
  if (!t) return { intent: "clarify", source: "default" };
  // SECURITY: destructive and shell requests are refused before any evidence or model call.
  if (has(t, "shell")) return { intent: "refuse", source: "rules", refuse: "shell" };
  if (has(t, "destructive")) return { intent: "refuse", source: "rules", refuse: "destructive" };
  if (has(t, "setup")) return { intent: "setup_redirect", source: "rules" };
  const requested: RequestedAction | undefined = has(t, "restart")
    ? "restart"
    : has(t, "resize")
      ? "resize"
      : has(t, "setEnv")
        ? "set_env"
        : has(t, "port")
          ? "update_port"
          : has(t, "stop")
            ? "stop"
            : has(t, "start")
              ? "start"
              : undefined;
  if (requested) return { intent: "action_request", source: "rules", requested };
  if (has(t, "diagnose")) return { intent: "diagnose", source: "rules" };
  if (has(t, "status")) return { intent: "status", source: "rules" };
  if (has(t, "explain")) return { intent: "explain", source: "rules" };
  return { intent: "clarify", source: "default" };
}

const RouterSchema = z.object({ intent: z.enum(INTENTS) });

/**
 * Rules first; the model only classifies text the rules could not place. A model answer of
 * `action_request` carries no requested action (the proposal builder decides from evidence).
 */
export async function routeIntent(text: string, router?: LanguageModel, signal?: AbortSignal): Promise<IntentResult> {
  const rules = routeIntentRules(text);
  if (rules.source === "rules" || !router) return rules;
  try {
    const r = await generateText({
      model: router,
      instructions: ROUTER_INSTRUCTIONS_FA,
      prompt: text.slice(0, ROUTER_BUDGET.maxInputChars),
      output: Output.object({ schema: RouterSchema }),
      maxOutputTokens: ROUTER_BUDGET.maxOutputTokens,
      maxRetries: 0,
      timeout: ROUTER_BUDGET.timeoutMs,
      ...(signal ? { abortSignal: signal } : {}),
    });
    const parsed = RouterSchema.safeParse(r.output);
    if (!parsed.success) return rules;
    // A model-chosen refusal is accepted (refusing is always safe); everything else stays evidence-gated.
    return { intent: parsed.data.intent, source: "llm", ...(parsed.data.intent === "refuse" ? { refuse: "destructive" as const } : {}) };
  } catch {
    return rules;
  }
}
