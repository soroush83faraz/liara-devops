// Markdown builders for untrusted text (model prose, log excerpts). SECURITY: text is redacted, cleaned of
// invisible/bidi controls, URLs are defanged and every Markdown/HTML-significant ASCII character is
// backslash-escaped, so model-written text can never become a link, image, HTML, heading, list or table.
// Log excerpts go into fenced code blocks whose fence is longer than any backtick run inside.
import { redactString } from "@/lib/security/redact";
import { cleanText } from "@/lib/security/unicode";

const SPECIAL = /[\\`*_{}[\]()#+\-.!|<>~&=:"'$^%@]/g;

/** Redact -> clean -> defang -> escape (order matters: cleaning would strip any zero-width defang). */
export function mdText(input: string, knownSecrets?: readonly string[]): string {
  const safe = cleanText(redactString(input, { knownSecrets }));
  const defanged = safe.replace(/:\/\//g, "[:]//").replace(/\bwww\./gi, "www[.]");
  return defanged
    .replace(SPECIAL, "\\$&")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "  \n");
}

/** Inline code for identifiers (keys, ids, timestamps). */
export function mdCode(input: string): string {
  const s = cleanText(input).replace(/[\r\n]+/g, " ");
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}

/** Fenced block for log excerpts; content is inert inside the fence. */
export function mdCodeBlock(input: string, knownSecrets?: readonly string[], max = 1500): string {
  let s = cleanText(redactString(input, { knownSecrets }));
  if (s.length > max) s = `${s.slice(0, max)}…`;
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${s}\n${fence}`;
}
