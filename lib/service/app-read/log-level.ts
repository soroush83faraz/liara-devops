import type { LogLevel } from "./types";

const LEVEL_WORDS: Record<string, LogLevel> = {
  fatal: "error",
  critical: "error",
  crit: "error",
  severe: "error",
  error: "error",
  err: "error",
  warn: "warn",
  warning: "warn",
  info: "info",
  notice: "info",
  debug: "debug",
  trace: "debug",
  verbose: "debug",
};

const NAMES = Object.keys(LEVEL_WORDS).join("|");
// `level=error`, `"level":"warn"`, `severity: info`
const KEYED = new RegExp(`["']?(?:level|severity|lvl)["']?\\s*[:=]\\s*["']?(${NAMES})\\b`, "i");
// `[ERROR] ...`, `ERROR: ...`, `2026-01-01T00:00:00Z WARN ...`, `E/Tag`
const PREFIX = new RegExp(
  `^\\W*(?:\\d{4}-\\d\\d-\\d\\d[T ][\\d:.,]+(?:Z|[+-]\\d\\d:?\\d\\d)?\\W+)?(?:\\w+\\W+)?\\[?(${NAMES})\\]?(?:\\b|:)`,
  "i",
);
const HTTP_STATUS = /\bHTTP\/\d(?:\.\d)?"?\s+([45]\d\d)\b/;
const ERROR_WORDS =
  /\b(fatal|panic|exception|traceback|unhandled|uncaught|segfault|oomkilled|out of memory|errno|EADDRINUSE|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|ERR_[A-Z_]+|error|failed|failure|cannot|can't|could not)\b/i;
const WARN_WORDS = /\b(warn(?:ing)?|deprecated|retrying|timeout)\b/i;
const DEBUG_WORDS = /\b(debug|trace|verbose)\b/i;

/**
 * Cheap, deterministic level guess from the text only. An explicit level token wins over keywords;
 * stderr alone is NOT treated as an error (many apps log info to stderr). Unmatched => "unknown".
 */
export function detectLogLevel(message: string): LogLevel {
  const head = message.slice(0, 400);
  const keyed = KEYED.exec(head) ?? PREFIX.exec(head);
  if (keyed) return LEVEL_WORDS[keyed[1]!.toLowerCase()] ?? "unknown";
  const http = HTTP_STATUS.exec(head);
  if (http) return http[1]!.startsWith("5") ? "error" : "warn";
  if (ERROR_WORDS.test(head)) return "error";
  if (WARN_WORDS.test(head)) return "warn";
  if (DEBUG_WORDS.test(head)) return "debug";
  return "unknown";
}
