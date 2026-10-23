// Output hygiene for model prose: plain text only. Model text is never trusted as markup, and it passes
// through the same redactor as evidence in case the model echoes something sensitive.
import { cleanText } from "@/lib/security/unicode";
import type { Redactor } from "@/lib/security/redact";

const TAG = /<\/?[A-Za-z!][^<>]{0,500}>/g;
const MD_LINK = /\[([^\]\n]{0,200})\]\([^)\n]{0,500}\)/g;
const MD_IMAGE = /!\[[^\]\n]{0,200}\]\([^)\n]{0,500}\)/g;
const CODE_FENCE = /```[a-zA-Z0-9_-]{0,20}/g;
const MD_MARKS = /(\*\*|__|~~|`)/g;
const HEADING = /^\s{0,3}#{1,6}\s+/gm;
const BULLET = /^\s{0,3}[*+]\s+/gm;
const URL_SCHEME = /\b(?:javascript|data|vbscript):/gi;

/** Strips HTML/Markdown, control and bidi characters; collapses whitespace; caps length. */
export function toPlainText(input: unknown, max: number, redactor?: Redactor): string {
  if (typeof input !== "string") return "";
  let s = cleanText(input.slice(0, max * 4));
  s = s.replace(MD_IMAGE, "").replace(MD_LINK, "$1").replace(TAG, " ").replace(CODE_FENCE, "");
  s = s.replace(HEADING, "").replace(BULLET, "- ").replace(MD_MARKS, "").replace(URL_SCHEME, "");
  // Any stray angle brackets left after tag removal cannot form markup in a plain-text part, but drop them anyway.
  s = s.replace(/[<>]/g, " ");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (redactor) s = redactor.string(s);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
