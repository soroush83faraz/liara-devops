// Small pure text helpers shared by the copilot cards (no React, no browser APIs).
import { faNumber } from "@/lib/i18n/format";
import { fa } from "@/lib/i18n/fa";

/** Fills `{name}` placeholders; numbers get Persian digits, unknown placeholders stay visible. */
export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = params[name];
    if (v === undefined) return match;
    return typeof v === "number" ? faNumber(v) : v;
  });
}

// Bidi embedding/override/isolate controls (Trojan-Source style reordering). ZWNJ/ZWJ are kept: Persian needs them.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
// C0/C1 controls except tab, LF, CR.
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Removes bidi override/isolate and control characters from model- or log-written text. */
export function stripUnsafeChars(input: string): string {
  return input.replace(BIDI_CONTROLS, "").replace(CONTROLS, "");
}

/** `3` -> «۳»; non-finite -> em dash. */
export function faCount(n: number): string {
  return faNumber(n);
}

/** Remaining milliseconds -> «۹:۴۵» style countdown with Persian digits (never negative). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${faNumber(m)}:${faNumber(s, { minimumIntegerDigits: 2 })}`;
}

/** Snapshot cell (before/after table). Numbers get Persian digits; strings are returned as-is (render them LTR). */
export function formatSnapshotValue(v: string | number | boolean | null | undefined): { text: string; ltr: boolean } {
  if (v === null || v === undefined) return { text: fa.common.dash, ltr: false };
  if (typeof v === "number") return { text: faNumber(v), ltr: false };
  if (typeof v === "boolean") return { text: v ? fa.common.yes : fa.common.no, ltr: false };
  return { text: stripUnsafeChars(v), ltr: true };
}

/** First char-safe truncation (does not split surrogate pairs). */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}
