// Line normalisation, signatures and de-duplication. Pure.
import type { EvidenceLine, LogGroup } from "./types";

/** Longest message kept per line; longer lines are cut before matching (bounds regex cost). */
export const MAX_LINE_CHARS = 2000;
/** Lines analysed per source; the newest are kept. */
export const MAX_LINES = 20_000;

const EPOCH_ISO = new Date(0).toISOString();

// CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL|ST`) and two-char escapes. Build tools colour npm errors
// (live 2026-10-23: "\u001b[91mnpm error code ETARGET...\u001b[0m"); colour codes break matching and display.
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|\u009b[0-?]*[ -/]*[@-~]/g;

/** Removes ANSI escape sequences (colours, cursor moves). Applied before extraction, display and redaction. */
export function stripAnsi(text: string): string {
  return text.includes("\u001b") || text.includes("\u009b") ? text.replace(ANSI_RE, "") : text;
}

/** Builds an EvidenceLine from any `{ts, stream, message}` shape. Epoch timestamps mean "no timestamp". */
export function toEvidenceLine(
  l: { ts?: string; stream?: string; message: string; releaseId?: string },
  redact: (s: string) => string,
): EvidenceLine {
  const ms = l.ts && l.ts !== EPOCH_ISO ? Date.parse(l.ts) : NaN;
  const stream = l.stream === "stdout" || l.stream === "stderr" ? l.stream : l.stream === "STDERR" ? "stderr" : l.stream === "STDOUT" ? "stdout" : "unknown";
  const clean = stripAnsi(l.message);
  const msg = clean.length > MAX_LINE_CHARS ? clean.slice(0, MAX_LINE_CHARS) : clean;
  return {
    ...(Number.isFinite(ms) && ms > 0 ? { ts: new Date(ms).toISOString(), ms } : {}),
    stream,
    message: redact(msg).replace(/\r/g, ""),
    ...(l.releaseId ? { releaseId: l.releaseId } : {}),
  };
}

// Order matters: timestamps before bare numbers, uuids/hex before digit runs.
const NORMALIZERS: Array<[RegExp, string]> = [
  [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>"],
  [/\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, "<time>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // hex ids: 8+ hex chars that contain at least one digit (so plain words like "deadbeef" stay)
  [/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, "<hex>"],
  [/\d+/g, "#"],
  [/\s+/g, " "],
];

/** Normalised signature of a line: numbers, ids and timestamps replaced, whitespace collapsed. */
export function lineSignature(message: string): string {
  let s = message.length > 400 ? message.slice(0, 400) : message;
  for (const [re, rep] of NORMALIZERS) s = s.replace(re, rep);
  return s.trim();
}

/**
 * Collapses repeated lines by signature, keeping first-appearance order, counts and first/last seen. Lines of
 * different releases never share a group, so every group (and every observation built from it) belongs to one release.
 */
export function groupLines(lines: readonly EvidenceLine[]): LogGroup[] {
  const map = new Map<string, LogGroup>();
  lines.forEach((l, i) => {
    if (!l.message.trim()) return;
    const pattern = lineSignature(l.message);
    const key = `${l.releaseId ?? ""}\u0000${pattern}`;
    const g = map.get(key);
    if (!g) {
      map.set(key, {
        pattern,
        message: l.message,
        count: 1,
        firstIndex: i,
        stream: l.stream,
        ...(l.ts ? { firstTs: l.ts, lastTs: l.ts, firstMs: l.ms, lastMs: l.ms } : {}),
        ...(l.releaseId ? { releaseId: l.releaseId } : {}),
      });
      return;
    }
    g.count++;
    if (l.ms !== undefined) {
      if (g.firstMs === undefined || l.ms < g.firstMs) {
        g.firstMs = l.ms;
        g.firstTs = l.ts;
      }
      if (g.lastMs === undefined || l.ms > g.lastMs) {
        g.lastMs = l.ms;
        g.lastTs = l.ts;
      }
    }
  });
  return [...map.values()];
}

/** Aggregates several groups (e.g. all lines naming the same env key). */
export interface Occurrence {
  count: number;
  firstTs?: string;
  lastTs?: string;
  firstMs?: number;
  lastMs?: number;
  sample: string;
  /** Release of the first occurrence (runtime/build lines carry it). */
  releaseId?: string;
}

export function mergeOccurrence(acc: Occurrence | undefined, g: LogGroup): Occurrence {
  if (!acc) {
    return { count: g.count, firstTs: g.firstTs, lastTs: g.lastTs, firstMs: g.firstMs, lastMs: g.lastMs, sample: g.message, ...(g.releaseId ? { releaseId: g.releaseId } : {}) };
  }
  const out = { ...acc, count: acc.count + g.count };
  if (g.firstMs !== undefined && (out.firstMs === undefined || g.firstMs < out.firstMs)) {
    out.firstMs = g.firstMs;
    out.firstTs = g.firstTs;
    if (g.releaseId) out.releaseId = g.releaseId;
  }
  if (g.lastMs !== undefined && (out.lastMs === undefined || g.lastMs > out.lastMs)) {
    out.lastMs = g.lastMs;
    out.lastTs = g.lastTs;
  }
  return out;
}

/** Occurrence of one item outside the log stream (e.g. an applet reason). */
export function singleOccurrence(sample: string, ts?: string): Occurrence {
  const ms = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(ms) && ms > 0
    ? { count: 1, sample, firstTs: new Date(ms).toISOString(), lastTs: new Date(ms).toISOString(), firstMs: ms, lastMs: ms }
    : { count: 1, sample };
}

export function combineOccurrences(acc: Occurrence | undefined, o: Occurrence): Occurrence {
  if (!acc) return o;
  return mergeOccurrence(acc, {
    pattern: "",
    message: o.sample,
    count: o.count,
    firstIndex: 0,
    stream: "unknown",
    firstTs: o.firstTs,
    lastTs: o.lastTs,
    firstMs: o.firstMs,
    lastMs: o.lastMs,
    ...(o.releaseId ? { releaseId: o.releaseId } : {}),
  });
}

/** Common params for an aggregated occurrence. */
export function occurrenceParams(o: Occurrence): Record<string, string | number> {
  return {
    count: o.count,
    ...(o.firstTs ? { firstSeen: o.firstTs } : {}),
    ...(o.lastTs ? { lastSeen: o.lastTs } : {}),
    ...(o.releaseId ? { releaseId: o.releaseId } : {}),
  };
}

/** Lines that look like an error (used for onset detection and generic log errors). */
export const ERROR_LINE_RE =
  /\b(?:error|exception|fatal|panic|traceback|uncaught|unhandled|crash(?:ed)?|segfault|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EADDRINUSE|OOMKilled)\b|npm ERR!|\b(?:KeyError|ImproperlyConfigured)\b|\b[A-Za-z_][\w.]{0,80}(?:Error|Exception)\b(?=:|\s*\[)/i;

export function isErrorLine(message: string): boolean {
  // "0 errors" / "no error" style progress lines are not errors.
  if (/\b(?:0|no) errors?\b/i.test(message)) return false;
  return ERROR_LINE_RE.test(message);
}
