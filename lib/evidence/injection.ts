// Prompt-injection flagging for evidence text. Single entry point `markSuspicious()`: the shared heuristics in
// lib/security/injection are authoritative; the few local rules below only add evidence-specific phrasings
// (secret exfiltration, "dear AI") on top. A hit is a signal for the UI/prompt, not a security boundary.
import { suspiciousReasons } from "@/lib/security/injection";
import { cleanText, foldForMatch } from "@/lib/security/unicode";

export interface SuspicionResult {
  suspicious: boolean;
  reasons: string[];
}

// Bounded quantifiers keep matching linear on hostile multi-kB lines.
const LOCAL_RULES: Array<[string, RegExp]> = [
  ["ignore_instructions", /\b(?:ignore|disregard|forget|override)\b.{0,40}\b(?:previous|prior|above|earlier|all|system|your)\b.{0,40}\b(?:instructions?|prompts?|rules?|messages?|context)\b/i],
  ["role_prefix", /^\s*(?:system|assistant|developer)\s*:/i],
  ["tool_invocation", /\b(?:propose_action|call (?:the )?tool|function_call|tool_use)\b/i],
  ["secret_exfiltration", /\b(?:print|reveal|show|send|leak|output|echo)\b.{0,30}\b(?:api[_ ]?key|token|password|secret|credentials?|env(?:ironment)? (?:values|variables))\b/i],
  ["ai_addressed", /\b(?:dear|attention|note to|hey)\s+(?:ai|assistant|copilot|llm|chatgpt|claude|model)\b/i],
  // Persian: «دستورات/دستورالعمل‌های قبلی را نادیده بگیر».
  ["ignore_instructions_fa", /(?:دستور|دستورالعمل|قوانین)[^\n]{0,30}(?:قبلی|بالا)[^\n]{0,30}نادیده/],
];

const MAX_SCAN = 4000;

/** Flags text that looks like an instruction aimed at the assistant. The text itself is kept for display. */
export function markSuspicious(text: string): SuspicionResult {
  const bounded = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
  const shared: string[] = suspiciousReasons(bounded);
  const folded = foldForMatch(cleanText(bounded));
  const local = LOCAL_RULES.filter(([, re]) => re.test(folded)).map(([name]) => name);
  const reasons = [...new Set([...shared, ...local])];
  return { suspicious: reasons.length > 0, reasons };
}
