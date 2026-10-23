/**
 * Unicode hygiene shared by redaction and injection detection.
 *
 * `cleanText` changes what is shown/stored: well-formed, NFKC, without ANSI escapes,
 * control characters (except \t \n \r), invisible or bidi-control characters
 * (defeats zero-width / color-code splitting of secrets, Trojan-
 * Source style reordering in the UI, and "ASCII smuggling" via Unicode tag
 * characters that LLMs read but humans cannot see). ZWNJ is kept only between
 * two Arabic-script letters, where Persian needs it.
 *
 * `foldForMatch` is used only to *find* things. It maps one UTF-16 unit to one
 * unit (confusables, Persian/Arabic digits), so match offsets in the folded copy
 * are valid offsets in the cleaned text.
 */

// Zero-width, bidi controls, soft hyphen, word joiners, variation selectors,
// Hangul fillers, BOM, interlinear annotations. ZWNJ (U+200C) is handled apart.
const INVISIBLE_BMP =
  /[­͏؜ᅟᅠ឴឵᠋-᠏​‍-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￹-￻]/g;
// Unicode tag characters U+E0000-U+E007F and variation selectors supplement U+E0100-U+E01EF.
const INVISIBLE_ASTRAL = /\uDB40[\uDC00-\uDC7F\uDD00-\uDDEF]/g;
const ZWNJ = /‌/g;
// ANSI escape sequences (CSI, OSC, 2-char ESC) — colored loggers put them between a key and its value.
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_])/g;
// C0/C1 controls and DEL, except tab, line feed and carriage return.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/;

/** True when the text contains characters used for smuggling or visual spoofing. */
export function hasInvisibleControls(text: string): boolean {
  INVISIBLE_ASTRAL.lastIndex = 0;
  const astral = INVISIBLE_ASTRAL.test(text);
  INVISIBLE_ASTRAL.lastIndex = 0;
  return astral || /[‪-‮⁦-⁩​⁠﻿]/.test(text);
}

export function cleanText(input: string): string {
  let s = typeof input === "string" ? input : String(input);
  s = s.toWellFormed();
  s = s.normalize("NFKC");
  s = s.replace(ANSI_ESCAPE, "").replace(CONTROL_CHARS, "");
  s = s.replace(INVISIBLE_ASTRAL, "").replace(INVISIBLE_BMP, "");
  if (s.includes("‌")) {
    s = s.replace(ZWNJ, (_m, offset: number, whole: string) => {
      const prev = whole[offset - 1] ?? "";
      const next = whole[offset + 1] ?? "";
      return ARABIC_LETTER.test(prev) && ARABIC_LETTER.test(next) ? "‌" : "";
    });
  }
  return s;
}

// Latin look-alikes (Cyrillic, Greek, IPA), Turkish dotted I, Persian and Arabic-Indic digits.
const CONFUSABLES: Readonly<Record<string, string>> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y",
  "х": "x", "ѕ": "s", "і": "i", "ј": "j", "ԁ": "d", "ԛ": "q",
  "ԝ": "w", "һ": "h", "ӏ": "l", "ɑ": "a", "ɡ": "g", "ɩ": "i",
  "ο": "o", "ν": "v", "α": "a", "ρ": "p", "κ": "k", "ι": "i",
  "υ": "u", "ϲ": "c", "τ": "t",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H",
  "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y",
  "Ѕ": "S", "І": "I", "Ј": "J", "Α": "A", "Β": "B", "Ε": "E",
  "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N",
  "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X", "İ": "I",
  "ı": "i",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}۰-۹٠-٩]`, "g");

export function foldForMatch(cleaned: string): string {
  return cleaned.replace(CONFUSABLE_RE, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(48 + code - 0x06f0);
    if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(48 + code - 0x0660);
    return CONFUSABLES[ch] ?? ch;
  });
}
