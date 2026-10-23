// Certainty / claims filter for model prose (H2). Model text is never trusted to state facts: sentences that assert
// certainty ("definitely", «قطعی», «تأیید شده», "root cause is …"), claim a fix, or recommend an action that the
// validated proposal does not contain are dropped. What remains is shown only inside a labelled "model summary"
// block, after the code-built sections. Pure; no Persian copy lives here (that is in fa-messages.ts).
import type { ActionType } from "@/lib/contracts/action";

const ZWNJ = "\u200c";

/** Certainty and "confirmed/fixed" assertions (Persian with/without ZWNJ, Arabic/Persian yeh/kaf variants, English). */
const CERTAINTY: readonly RegExp[] = [
  /قطع[یيی]|قطعا|قطعاً/u,
  /ت[أا][یي]ی?د[\s\u200c]*(?:شد|شده|می[\s\u200c]*شود|کرد)/u,
  /حتم[اًا]|حتماً/u,
  /مطمئن[اًا]?|مطمئناً|اطمینان\s*(?:داریم|داری|دارم)/u,
  /بدون[\s\u200c]*(?:شک|تردید)|بی[\s\u200c]*(?:شک|تردید)|یقین/u,
  /برطرف[\s\u200c]*(?:شد|شده|می[\s\u200c]*شود)|حل[\s\u200c]*(?:شد|شده)(?!\S)/u,
  /\b(?:confirmed|definitely|certainly|undoubtedly|guaranteed|for sure|100\s*%|root[\s-]*cause\s+(?:is|was)|is\s+the\s+cause|fixed|resolved)\b/i,
];

/** Recommendation / fix-promise markers: a sentence must contain one of these to count as recommending an action. */
const RECOMMENDS = /باید|پیشنهاد|توصیه|بهتر\s*است|کنید|بکنید|بزنید|دهید|بدهید|حل[\s\u200c]*می[\s\u200c]*(?:کند|شود)|درست[\s\u200c]*می[\s\u200c]*شود|برطرف|\b(?:should|must|recommend|try|fix(?:es)?|solve[sd]?|will\s+help)\b/iu;

/** Action vocabulary per proposable action type. */
const ACTION_WORDS: ReadonlyArray<readonly [ActionType | "upgrade", RegExp]> = [
  ["restart", /ری[\s\u200c]*استارت|ریستارت|راه[\s\u200c]*اندازی[\s\u200c]*(?:ی[\s\u200c]*)?مجدد|\brestart/iu],
  ["resize", /ارتقا|ارتقاء|پلن[\s\u200c]*(?:بزرگ|بالاتر|بیشتر)|رم\s*بیشتر|RAM\s*بیشتر|\b(?:resize|upgrade)\b/iu],
  ["set_env", /متغیر[\s\u200c]*(?:های[\s\u200c]*)?محیطی|\benv(?:ironment)?\s*var|\bset_env\b/iu],
  ["update_port", /پورت|\bport\b/iu],
  ["redeploy_previous", /نسخه[\s\u200c]*(?:ی|ٔ)?[\s\u200c]*قبل|برگرداندن|بازگشت\s*به\s*نسخه|\b(?:rollback|roll back|redeploy)\b/iu],
  ["scale", /خاموش|روشن[\s\u200c]*کردن|\b(?:scale|stop|start)\b/iu],
  ["wire_db", /اتصال\s*(?:به\s*)?(?:پایگاه|دیتابیس)|\bwire\b/iu],
];

export interface FilterResult {
  text: string;
  dropped: number;
}

/** Splits prose into sentences, keeping terminators. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?؟؛\n]+[.!?؟؛]*|\n+/gu) ?? []).map((s) => s.trim()).filter((s) => s && s !== ZWNJ);
}

/** "The (root/main) cause is X" stated as fact; a hedged sentence ("may", «ممکن است», «احتمالاً») is not an assertion. */
const CAUSE_ASSERTION = /(?:علت|ریشه)[\s\u200c]*(?:ی|ٔ)?[\s\u200c]*(?:اصلی|واقعی|مشکل)?[^.!?؟؛\n]{0,60}\s(?:است|هست|بود)(?=\s|$|[.!?؟؛])/u;
const HEDGE = /ممکن|احتمال|شاید|محتمل|فرضیه|\b(?:may|might|possibly|probably|likely|could)\b/iu;

export const assertsCertainty = (s: string): boolean => CERTAINTY.some((r) => r.test(s)) || (CAUSE_ASSERTION.test(s) && !HEDGE.test(s));

/** The action types a sentence recommends (empty when it is not a recommendation). */
export function recommendedActions(s: string): string[] {
  if (!RECOMMENDS.test(s)) return [];
  return ACTION_WORDS.filter(([, r]) => r.test(s)).map(([a]) => (a === "upgrade" ? "resize" : a));
}

/**
 * Keeps only sentences that neither assert certainty nor recommend an action outside `allowedActions`.
 * `allowedActions` is the validated proposal's type (summary) or the rule-backed action hint (explanations).
 */
export function filterModelProse(text: string, allowedActions: readonly string[] = []): FilterResult {
  const allowed = new Set(allowedActions);
  const kept: string[] = [];
  let dropped = 0;
  for (const s of sentences(text)) {
    const bad = assertsCertainty(s) || recommendedActions(s).some((a) => !allowed.has(a));
    if (bad) dropped++;
    else kept.push(s);
  }
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), dropped };
}
