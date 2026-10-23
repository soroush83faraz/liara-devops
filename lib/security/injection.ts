import { cleanText, foldForMatch, hasInvisibleControls } from "./unicode";

/**
 * Prompt-injection hygiene for untrusted text (logs, build output, events).
 *
 * `flagSuspiciousLines` is a heuristic *signal* (observation.flagged, a UI badge,
 * a note in the prompt); it is not a security boundary. The boundary is that the
 * model has no mutating tool and every action needs a user-approved token.
 * The patterns are deliberately broad (paraphrased and polite phrasing, approval
 * steering, role markers, tool names, identifier-style SPELLED_OUT_INSTRUCTIONS):
 * a false positive only withholds one line from the model (it is counted), while
 * a miss lets attacker-written text argue with the model. They will still miss
 * novel phrasings - never rely on them to make anything safe.
 * `wrapUntrusted` marks data for the model and guarantees the text cannot close
 * or reopen the wrapper: `&`, `<`, `>` are entity-escaped after NFKC, so no tag
 * of any kind (fullwidth or zero-width variants included) can be formed.
 */

export const INJECTION_REASONS = [
  "override_instructions",
  "system_prompt",
  "chat_template",
  "role_change",
  "addressed_to_ai",
  "approval_steering",
  "tool_call",
  "destructive_request",
  "ops_request",
  "env_change_request",
  "shell_destructive",
  "remote_exec",
  "encoded_payload",
  "invisible_chars",
] as const;
export type InjectionReason = (typeof INJECTION_REASONS)[number];

export interface FlaggedLine {
  index: number;
  reasons: InjectionReason[];
}

const MAX_LINE_SCAN = 64 * 1024;
const MAX_LINES = 50_000;

/** Lowercased, folded, Persian-normalized copy for matching only. */
function normalizeForMatch(line: string): string {
  return foldForMatch(cleanText(line.length > MAX_LINE_SCAN ? line.slice(0, MAX_LINE_SCAN) : line))
    .replace(/[يى]/g, "ی") // Arabic yeh -> Persian yeh
    .replace(/ك/g, "ک") // Arabic kaf -> Persian keheh
    .replace(/ة/g, "ه")
    .replace(/[ً-ٰٟـ]/g, "") // harakat, tatweel
    .replace(/‌/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const PATTERNS: ReadonlyArray<readonly [InjectionReason, RegExp]> = [
  ["override_instructions", /\b(?:ignore|disregard|forget|override|bypass)\b[^\n]{0,40}?\b(?:previous|prior|above|earlier|preceding|all|any|your|the|these|system|developer)\b[^\n]{0,30}?\b(?:instructions?|prompts?|rules?|directions?|guidelines?|guardrails?|context|messages?|polic(?:y|ies))\b/],
  ["override_instructions", /\bnew (?:instructions?|rules|task)\s?:/],
  ["override_instructions", /(?:دستور|دستورات|دستورالعمل|پیام)(?: ?ها| ?های)? ?(?:قبلی|پیشین|قبل|بالا)[^\n]{0,20}?(?:نادیده|فراموش|کنار)/],
  // `\b` is ASCII-only in JS, so Persian patterns end with a Persian-letter lookahead instead.
  ["override_instructions", /نادیده ?بگیر|فراموش ?کن(?:ید)?(?![؀-ۿ])/],
  ["system_prompt", /\bsystem[ _-]?prompt\b/],
  ["system_prompt", /\b(?:reveal|print|show|output|repeat|leak)\b[^\n]{0,30}?\b(?:system|hidden|initial|original)\s(?:prompt|instructions?|message)\b/],
  ["system_prompt", /\bdeveloper (?:mode|message|instructions?)\b/],
  ["system_prompt", /(?:پرامپت|دستور(?:العمل)?(?: ?های| ?ها)?) ?سیستم(?:ی)?/],
  ["chat_template", /<\|(?:im_start|im_end|system|user|assistant|endoftext|eot_id|start_header_id)\|>|\[\/?(?:inst|sys)\]|<<\/?sys>>/],
  ["chat_template", /<\/?(?:system|assistant|user|tool|tool_call|function_call|untrusted_log|instructions?)\b[^>]{0,40}>/],
  ["chat_template", /^ ?(?:assistant|ai assistant|claude|chatgpt|gpt|llm) ?:|^ ?#{2,} ?(?:system|instructions?)\b/],
  ["role_change", /\byou are (?:now|no longer)\b|\bfrom now on\b|\bpretend (?:to be|you are)\b|\bjailbreak|\bdo anything now\b|\bdan mode\b/],
  ["role_change", /\bact as (?:an? |the )?(?:ai|assistant|admin|administrator|root|system|developer|different)\b/],
  ["role_change", /از این به بعد (?:تو|شما)|(?:تو|شما) (?:اکنون|الان|حالا)[^\n]{0,40}?(?:هستی|هستید|باید)/],
  // Role markers: assistant-ish names anywhere; "system:"/"developer:" at the start of the line or of the log
  // message (after a bracket or a stream/level token: "ts stdout system: ..."), not "Operating system: Linux".
  ["chat_template", /(?:^|[\s\]>|)(:])(?:assistant|ai assistant|claude|chatgpt|gpt|llm|copilot)\s?:\s/],
  ["chat_template", /(?:^\s?|[\]>|)]\s?|\b(?:stdout|stderr|info|warn|warning|error|debug|log|trace|notice)\s)(?:system|developer)\s?:\s/],
  ["chat_template", /(?:^\s?|[\]>|)]\s?|\b(?:stdout|stderr|info|warn|warning|error|debug|log|trace|notice)\s)(?:سیستم|دستیار|هوش مصنوعی)\s?:\s/],
  // Text that talks TO the assistant ("Assistant, kindly ...", "note to the AI operator", "dear model").
  ["addressed_to_ai", /(?:^|[\s\]>|)(:])(?:hey |hi |dear |attention |ok |okay )?(?:ai|assistant|model|llm|bot|copilot|agent|claude|chatgpt|gpt)\s?[,:!]\s?(?:please |kindly |now |you |we |it |the |make |ensure |tell |advise |ask |approve|recommend|suggest|propose|do |don'?t )/],
  ["addressed_to_ai", /\b(?:note|message|instructions?|reminder|attention|memo|hint)\s(?:to|for)\s(?:the\s|any\s|all\s)?(?:ai|assistant|model|llm|bot|copilot|agent|operator|reader|automated|language model)\b/],
  ["addressed_to_ai", /\b(?:if you are|as an?|dear|hey|hello)\s(?:an?\s|the\s)?(?:ai|assistant|language model|llm|chatbot|bot|copilot|agent)\b/],
  ["addressed_to_ai", /(?:ای |به )?(?:دستیار|هوش مصنوعی|مدل زبانی|ربات)(?: عزیز)?[،,:][^\n]{0,60}?(?:لطفا|لطفاً|باید|بگو|کن|کنید)/],
  // Steering the HUMAN towards approving (the only thing the model can influence).
  ["approval_steering", /\b(?:advise|tell|ask|instruct|convince|urge|persuade|recommend|encourage|remind|get|have|make|let)\b[^\n]{0,30}?\b(?:the |your )?(?:user|human|operator|admin|administrator|owner|customer|person|team|developer)s?\b[^\n]{0,40}?\b(?:approve|confirm|accept|authori[sz]e|allow|click|press|grant|sign off|consent|agree)\b/],
  ["approval_steering", /\b(?:approve|authori[sz]e|accept|confirm|grant)\s(?:the |this |that |all |every |any |my |our )?(?:pending |proposed |suggested |queued |new )?(?:actions?|proposals?|requests?|changes?|deployments?|fix(?:es)?|operations?|restarts?|permissions?|access)\b/],
  ["approval_steering", /\b(?:please|kindly|just|simply|immediately|quickly|now)\s(?:approve|authori[sz]e|confirm|accept|click approve|press approve)\b|\bclick (?:on )?(?:the )?(?:approve|confirm|accept|ok) button\b/],
  ["approval_steering", /(?:کاربر|مدیر|ادمین|انسان|اپراتور)(?: را)?[^\n]{0,40}?(?:بگو|بگویید|بخواه|بخواهید|توصیه کن|متقاعد کن|راضی کن|وادار کن|تشویق کن)[^\n]{0,30}?(?:تا?ٔ?یید|تأیید|قبول|موافقت|اجازه|مجوز)/],
  ["approval_steering", /(?:تا?ٔ?یید|تأیید|قبول|موافقت) ?(?:کن|کنید|کند|کنند|نما|نمایید|بزن|بزنید)(?![؀-ۿ])|(?:اجازه|مجوز) ?(?:بده|بدهید|بدهد)(?![؀-ۿ])/],
  ["tool_call", /\b(?:call|invoke|trigger|use)\s(?:the\s)?(?:[a-z_]+\s)?tool\b|\b(?:propose_action|tool_calls?|function_call|tool_use)\b/],
  ["tool_call", /"(?:name|tool|function|tool_name)" ?: ?"(?:propose_action|set_env|unset_env|restart|scale|resize|update_port|wire_db|deploy_plan|redeploy_previous|create_[a-z]+|delete_[a-z]+)"/],
  // Tool / action identifiers of this product written out in text, and "restart" used as a call.
  ["tool_call", /\b(?:set_env|unset_env|update_port|wire_db|deploy_plan|redeploy_previous|delete_app|delete_db|create_app|create_db|get_app_status|get_runtime_logs|get_build_logs|get_db_status|probe_site|list_releases)\b|\b(?:restart|scale|resize)\s?\(|\b(?:action|tool|type)\s?[:=]\s?["']?(?:restart|scale|resize|set_env|redeploy)\b/],
  ["tool_call", /(?:ابزار|تابع)[^\n]{0,30}?(?:را )?(?:صدا|فراخوانی|اجرا) ?(?:بزن|کن|کنید|بزنید)/],
  ["destructive_request", /\b(?:delete|drop|destroy|remove|wipe|erase|purge|terminate)\s(?:the|this|that|all|every|your|my|our)\s(?:[a-z0-9_-]+\s){0,2}?(?:apps?|applications?|databases?|dbs?|projects?|services?|data|tables?|files?|backups?|domains?|disks?|servers?|everything|resources?|users?|accounts?)\b/],
  ["destructive_request", /(?:حذف|پاک) ?(?:ش )?(?:کن|کنید|نما|نمایید)(?![؀-ۿ])/],
  ["ops_request", /\b(?:restart|reboot|redeploy|shut ?down|stop|scale (?:down|up)|resize|downgrade|upgrade)\s(?:the|this|your|my)\s(?:app|application|service|server|database|db|container|instance|plan)\b/],
  ["ops_request", /(?:ری ?استارت|ریستارت|راه ?اندازی مجدد|ری ?دیپلوی) ?(?:ش )?(?:کن|کنید)(?![؀-ۿ])/],
  ["env_change_request", /\bset[_-]env\b|\bunset[_-]env\b|\bupdate[_-]envs\b|\b(?:please|now|must|should)\s(?:set|change|update|unset|add)\s(?:the\s)?(?:env|environment)\b/],
  ["env_change_request", /متغیر(?: ?های)?(?: محیطی)?[^\n]{0,40}?(?:را )?(?:تغییر|تنظیم|عوض|حذف|اضافه) ?(?:بده|بدهید|کن|کنید)/],
  ["shell_destructive", /\brm\s-[a-z]*(?:rf|fr)[a-z]*\s(?:--no-preserve-root\s)?(?:\/(?:\s|\*|$)|~\/?(?:\s|$)|\*|\$home\b)/],
  ["shell_destructive", /\bmkfs(?:\.[a-z0-9]+)?\b|\bdd\sif=|:\(\)\s?\{\s?:\s?\|\s?:\s?&\s?\}\s?;\s?:|\bchmod\s(?:-r\s)?0?777\s\/(?:\s|$)|\bshred\s-|>\s?\/dev\/sd[a-z]\b/],
  ["remote_exec", /\b(?:curl|wget)\b[^|\n]{0,200}\|\s?(?:sudo\s)?(?:ba|z|da|k)?sh\b|\bbase64\s(?:-d|--decode)\b[^|\n]{0,100}\|\s?(?:sudo\s)?(?:ba|z)?sh\b/],
  ["remote_exec", /\/dev\/tcp\/|\bnc(?:at)?\s(?:-[a-z]+\s)*-e\s|\bpowershell(?:\.exe)?\b[^\n]{0,60}\s-(?:enc|encodedcommand|e)\s|\biex\s?\(|\beval\s?\(\s?(?:atob|base64_decode|buffer\.from)/],
];

const BASE64_RUN = /[A-Za-z0-9+/_-]{24,}={0,2}/g;
const PAYLOAD_WORDS = [
  "rm -rf", "curl ", "wget ", "/bin/sh", "/bin/bash", "bash -c", "sh -c", "ignore previous", "ignore all",
  "system prompt", "you are now", "propose_action", "set_env", "delete ", "drop table", "eval(", "exec(",
  "powershell", "nc -e", "/dev/tcp", "chmod 777", "نادیده بگیر", "حذف کن",
];

function decodeBase64Text(run: string): string | undefined {
  try {
    const std = run.replace(/-/g, "+").replace(/_/g, "/");
    const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
    const bin = atob(padded.slice(0, 8192));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let printable = 0;
    for (const ch of text) if (/[\x20-\x7E\t\r\n؀-ۿ‌]/.test(ch)) printable++;
    return printable / Math.max(1, [...text].length) >= 0.85 ? text.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function hasEncodedPayload(cleanedLine: string): boolean {
  let n = 0;
  for (const m of cleanedLine.matchAll(BASE64_RUN)) {
    if (++n > 16) break;
    const decoded = decodeBase64Text(m[0]);
    if (decoded && PAYLOAD_WORDS.some((w) => decoded.includes(w))) return true;
  }
  return false;
}

/** Reasons a single line looks like instructions aimed at the assistant (empty when none). */
export function suspiciousReasons(line: string): InjectionReason[] {
  const raw = typeof line === "string" ? line : String(line);
  const reasons = new Set<InjectionReason>();
  if (hasInvisibleControls(raw)) reasons.add("invisible_chars");
  const norm = normalizeForMatch(raw);
  // Identifier spelling (IGNORE_ALL_PREVIOUS_INSTRUCTIONS, approve-the-pending-action) is matched as words too.
  const spaced = /[_\-.]/.test(norm) ? norm.replace(/[_\-.]+/g, " ") : undefined;
  for (const [reason, pattern] of PATTERNS) {
    if (!reasons.has(reason) && (pattern.test(norm) || (spaced !== undefined && reason !== "tool_call" && pattern.test(spaced)))) reasons.add(reason);
  }
  if (hasEncodedPayload(cleanText(raw.slice(0, MAX_LINE_SCAN)))) reasons.add("encoded_payload");
  return [...reasons];
}

/** Flags instruction-like lines; returns their indexes and reasons, in order. */
export function flagSuspiciousLines(lines: readonly string[]): FlaggedLine[] {
  const out: FlaggedLine[] = [];
  const n = Math.min(lines.length, MAX_LINES);
  for (let i = 0; i < n; i++) {
    const reasons = suspiciousReasons(lines[i]);
    if (reasons.length > 0) out.push({ index: i, reasons });
  }
  return out;
}

export const UNTRUSTED_TAG = "untrusted_log";
const UNTRUSTED_DEFAULT_MAX = 20_000;
const TAG_NAME_LOOKALIKE = /untrusted[\W_]{0,3}log/gi;

/**
 * Wraps untrusted text for the model:
 *   <untrusted_log label="...">\n{escaped text}\n</untrusted_log>
 * The label is restricted to [A-Za-z0-9_.:/-]; the body is cleaned (NFKC, no
 * invisible/bidi characters), truncated, has look-alikes of the tag name defused,
 * and `& < >` entity-escaped.
 */
export function wrapUntrusted(label: string, text: string, opts?: { maxChars?: number }): string {
  const safeLabel = cleanText(String(label)).replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 64) || "log";
  let body = cleanText(typeof text === "string" ? text : String(text));
  const max = opts?.maxChars ?? UNTRUSTED_DEFAULT_MAX;
  if (body.length > max) body = `${body.slice(0, max)}\n…[truncated]`;

  // Find look-alikes on the 1:1 folded copy (homoglyphs), rewrite them in the body.
  const folded = foldForMatch(body);
  let defused = "";
  let pos = 0;
  for (const m of folded.matchAll(TAG_NAME_LOOKALIKE)) {
    const start = m.index ?? 0;
    defused += `${body.slice(pos, start)}untrusted-log`;
    pos = start + m[0].length;
  }
  body = defused + body.slice(pos);

  body = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<${UNTRUSTED_TAG} label="${safeLabel}">\n${body}\n</${UNTRUSTED_TAG}>`;
}
