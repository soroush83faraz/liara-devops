// Server-side masking for log/event text before it leaves the server.
// Two passes: the local rules below (line truncation, assignments, bearer/JWT/URL creds), then the shared
// redactor from lib/security/redact as defence in depth. Pass the app's redactor (logRedactorFor in
// ./known-secrets) so the app's own env values are also scrubbed in their transformed forms.
import { createRedactor, type Redactor } from "../../security/redact";

const PATTERNS_ONLY = createRedactor();

const REDACTED = "[REDACTED]";
const MAX_LINE_CHARS = 4000;

const SECRET_NAME =
  "[\\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|credential)[\\w.-]*";

const RULES: Array<[RegExp, string]> = [
  // Authorization headers / bearer tokens.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // JWT-shaped strings.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  // Credentials inside URLs: scheme://user:pass@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  // password=..., "token": "...", api_key: ..., SESSION_SECRET=...
  [
    new RegExp(`(["']?\\b${SECRET_NAME}["']?\\s*[:=]\\s*)("(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s,;&}]+)`, "gi"),
    `$1${REDACTED}`,
  ],
  // bare `key=value`
  [/(\bkey\s*=\s*)[^\s,;&}]+/gi, `$1${REDACTED}`],
];

function localMask(text: string): string {
  let out = text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…[truncated]` : text;
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}

/** Masks bearer tokens, JWTs, URL credentials and `password|secret|token|key=value` assignments. Never throws. */
export function maskSecrets(text: string, redactor: Redactor = PATTERNS_ONLY): string {
  try {
    return redactor.string(localMask(text));
  } catch {
    return REDACTED;
  }
}

/** Masks a batch of lines 1:1; also catches a known secret split across two adjacent lines. Never throws. */
export function maskLines(texts: readonly string[], redactor: Redactor = PATTERNS_ONLY): string[] {
  try {
    return redactor.lines(texts.map(localMask));
  } catch {
    return texts.map((t) => maskSecrets(t, redactor));
  }
}
