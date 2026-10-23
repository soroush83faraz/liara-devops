// http-status: 5xx counts/ratios from access-log-like lines. When none exist the collector records an
// explicit unknown ("status analytics unavailable"); this extractor then returns nothing.
import { draft, SIG } from "../observe";
import type { DraftObservation, EvidenceLine, ExtractContext } from "../types";

const METHOD = "(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)";
// Combined/uvicorn/gunicorn: "GET /path HTTP/1.1" 500
const COMBINED = new RegExp(String.raw`"${METHOD} (?<path>\S{1,300}) HTTP/\d(?:\.\d)?" (?<status>[1-5]\d\d)\b`);
// morgan dev/tiny, Laravel/Next style: GET /path 500 12.3 ms
const SHORT = new RegExp(String.raw`(?:^|\s)${METHOD} (?<path>/\S{0,300}) (?<status>[1-5]\d\d)\b`);
// JSON loggers (pino, winston): {"method":"GET","url":"/x","statusCode":500}
const JSON_STATUS = new RegExp(String.raw`"(?:statusCode|status|status_code)"\s*:\s*(?<status>[1-5]\d\d)\b`);
const JSON_PATH = new RegExp(String.raw`"(?:url|path|route)"\s*:\s*"(?<path>[^"]{1,300})"`);

export interface AccessHit {
  status: number;
  path?: string;
}

export function parseAccessLine(message: string): AccessHit | undefined {
  const m = COMBINED.exec(message) ?? SHORT.exec(message);
  if (m?.groups) return { status: Number(m.groups.status), path: m.groups.path };
  if (/"method"\s*:/.test(message)) {
    const s = JSON_STATUS.exec(message);
    if (s?.groups) return { status: Number(s.groups.status), path: JSON_PATH.exec(message)?.groups?.path };
  }
  return undefined;
}

// Latency written by the access logger: morgan dev/tiny "... 200 4800.3 ms", or a JSON field (pino-http, winston).
const TEXT_LATENCY = /\s(?<ms>\d{1,7}(?:\.\d+)?) ?ms\b/;
const JSON_LATENCY = /"(?:responseTime|response_time|duration|durationMs|latency|latencyMs|elapsed)"\s*:\s*(?<ms>\d{1,7}(?:\.\d+)?)/;

/** Request latency (ms) of an access-log line, when the logger writes one; undefined for non-access lines. */
export function accessLatencyMs(message: string): number | undefined {
  if (!parseAccessLine(message)) return undefined;
  const m = JSON_LATENCY.exec(message) ?? TEXT_LATENCY.exec(message);
  const ms = m?.groups ? Number(m.groups.ms) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

/** Minimum access lines before a ratio is reported. */
export const MIN_ACCESS_LINES = 5;

export function accessStats(lines: readonly EvidenceLine[]) {
  let total = 0;
  let s5xx = 0;
  let s4xx = 0;
  let first5xx: EvidenceLine | undefined;
  let last5xx: EvidenceLine | undefined;
  const paths = new Map<string, number>();
  for (const l of lines) {
    const hit = parseAccessLine(l.message);
    if (!hit) continue;
    total++;
    if (hit.status >= 500) {
      s5xx++;
      first5xx ??= l;
      last5xx = l;
      const p = (hit.path ?? "?").split("?")[0];
      paths.set(p, (paths.get(p) ?? 0) + 1);
    } else if (hit.status >= 400) s4xx++;
  }
  // Stable: highest count, then lexicographic path.
  const topPath = [...paths.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return { total, s5xx, s4xx, first5xx, last5xx, topPath };
}

export function extractHttpStatus(ctx: ExtractContext): DraftObservation[] {
  const st = accessStats(ctx.logs);
  if (st.total < MIN_ACCESS_LINES) return [];
  const ratio = (st.s5xx / st.total) * 100;
  const severity = ratio >= 20 ? "error" : ratio >= 5 ? "warn" : "info";
  return [
    draft("http_status", "liara:logs", st.s5xx ? "evidence.http.5xx_ratio" : "evidence.http.no_5xx", severity,
      st.first5xx?.message ?? `${st.total} requests, no 5xx`,
      {
        total: st.total,
        s5xx: st.s5xx,
        s4xx: st.s4xx,
        ratio5xxPct: ratio,
        topPath: st.topPath?.[0],
        topPathCount: st.topPath?.[1],
        firstSeen: st.first5xx?.ts,
        lastSeen: st.last5xx?.ts,
        [SIG]: ratio >= 20,
      }, st.first5xx?.ts),
  ];
}
