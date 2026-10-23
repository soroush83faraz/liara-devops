import { type LogLine, parseRuntimeLogs } from "./logs";
import { isRecord } from "./util";

/**
 * One container lifecycle event of an app (`create`, `start`, `die`, `kill`, `oom`, `stop`, `restart`, ...).
 * [V live 2026-10-23] `GET /v1/projects/{name}/events` answers
 * `{data:[{id:"<container id>",status,action,time:"<unix seconds>",release,tag}]}`, newest first.
 */
export interface AppLifecycleEvent {
  /** Epoch ms. Liara reports whole unix seconds. */
  ts: number;
  /** Lower-cased Docker-style lifecycle action (falls back to `status`). */
  action: string;
  /** Lower-cased `status` (falls back to `action`). */
  status: string;
  releaseId?: string;
  tag?: string;
  containerId?: string;
}

/** Both views of one events response: legacy log-style lines and structured lifecycle events. */
export interface AppEventsFeed {
  /** Old Loki-style lines plus one rendered line per lifecycle event, ascending. */
  lines: LogLine[];
  /** Lifecycle events, ascending. */
  lifecycle: AppLifecycleEvent[];
}

const MAX_LIFECYCLE_EVENTS = 500;

// Same-second ties: Docker's own order (create before start; die before the next start).
const RANK: Record<string, number> = { create: 0, oom: 1, kill: 2, die: 3, stop: 4, start: 5, restart: 6 };

function timeMs(v: unknown): number | undefined {
  let n = NaN;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{1,16}(?:\.\d+)?$/.test(s)) n = Number(s);
    else {
      const d = Date.parse(s); // ISO text: already milliseconds
      return Number.isFinite(d) && d > 0 ? d : undefined;
    }
  }
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Seconds per the live payload; 13+ digit values are already milliseconds.
  return Math.round(n >= 1e12 ? n : n * 1000);
}

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** A lifecycle row has an action/status and no Loki `values`. */
function parseRow(row: unknown): AppLifecycleEvent | undefined {
  if (!isRecord(row) || Array.isArray(row.values)) return undefined;
  const action = str(row.action, 32)?.toLowerCase();
  const status = str(row.status, 32)?.toLowerCase();
  const name = action ?? status;
  const ts = timeMs(row.time ?? row.timestamp ?? row.createdAt);
  if (!name || ts === undefined) return undefined;
  const releaseId = str(row.release ?? row.releaseId ?? row.releaseID, 100);
  const tag = str(row.tag, 64);
  const containerId = str(row.id, 80);
  return { ts, action: name, status: status ?? name, ...(releaseId ? { releaseId } : {}), ...(tag ? { tag } : {}), ...(containerId ? { containerId } : {}) };
}

/** Parses the live `{data:[…]}` (or a bare array) into ascending lifecycle events; malformed rows are dropped. Never throws. */
export function parseLifecycleEvents(raw: unknown): AppLifecycleEvent[] {
  try {
    const rows = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.data) ? raw.data : [];
    const out: AppLifecycleEvent[] = [];
    for (const row of rows.slice(0, MAX_LIFECYCLE_EVENTS)) {
      const e = parseRow(row);
      if (e) out.push(e);
    }
    return out.sort((a, b) => a.ts - b.ts || (RANK[a.action] ?? 9) - (RANK[b.action] ?? 9));
  } catch {
    return [];
  }
}

/** Log-style rendering of a lifecycle event so line-based consumers (UI list, agent, overview) can show it. */
export function lifecycleLine(e: AppLifecycleEvent): LogLine {
  const parts = [`container ${e.action}`];
  if (e.releaseId) parts.push(`release ${e.releaseId}`);
  if (e.tag) parts.push(`tag ${e.tag}`);
  return { ts: new Date(e.ts).toISOString(), tsNs: (BigInt(e.ts) * BigInt(1_000_000)).toString(), stream: "unknown", message: parts.join(" "), ...(e.releaseId ? { releaseId: e.releaseId } : {}) };
}

/** Understands the live lifecycle shape and, as a fallback, the older Loki-style `{data:[{metaData,values}]}` shape (also mixed). */
export function parseAppEvents(raw: unknown): AppEventsFeed {
  const lifecycle = parseLifecycleEvents(raw);
  const lines = [...parseRuntimeLogs(raw), ...lifecycle.map(lifecycleLine)];
  const key = (l: LogLine) => BigInt(l.tsNs);
  lines.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { lines, lifecycle };
}
