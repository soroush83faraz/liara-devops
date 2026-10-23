import { z } from "zod";
import { isLiaraError, type LiaraClient } from "./core";
import { BuildLogsResponseSchema, type BuildLogsResponse } from "./schemas";
import { isRecord, seg, sleep } from "./util";

export interface LogLine {
  /** ISO-8601 timestamp (epoch when the source line carried none). */
  ts: string;
  /** Unix nanoseconds as a decimal string (BigInt-safe, sortable via BigInt()). */
  tsNs: string;
  stream: "stdout" | "stderr" | "unknown";
  message: string;
  releaseId?: string;
}

// tsconfig targets ES2017, so no bigint literals.
const NS_PER_MS = BigInt(1_000_000);
const NS_PER_S = BigInt(1_000_000_000);
const ZERO = BigInt(0);
const EPOCH = new Date(0).toISOString();

function nsToIso(ns: string): string {
  try {
    return new Date(Number(BigInt(ns) / NS_PER_MS)).toISOString();
  } catch {
    return EPOCH;
  }
}

function fromNs(ns: string, message: string, stream: LogLine["stream"], releaseId?: string): LogLine {
  const valid = /^\d{1,25}$/.test(ns);
  const tsNs = valid ? ns : "0";
  return { ts: valid ? nsToIso(tsNs) : EPOCH, tsNs, stream, message, ...(releaseId ? { releaseId } : {}) };
}

function fromDate(datetime: unknown, message: string, stream: LogLine["stream"]): LogLine {
  const ms = typeof datetime === "string" || typeof datetime === "number" ? new Date(datetime).getTime() : NaN;
  if (Number.isNaN(ms)) return fromNs("0", message, stream);
  return { ts: new Date(ms).toISOString(), tsNs: (BigInt(ms) * NS_PER_MS).toString(), stream, message };
}

const toStream = (t: unknown): LogLine["stream"] => {
  const s = typeof t === "string" ? t.toLowerCase() : "";
  return s === "stdout" || s === "stderr" ? s : "unknown";
};

/** One Loki-style `[ns, payload]` value. Payload is usually a JSON string `{_entry,type}` [CLI logs.ts]. */
function parseValue(value: unknown, releaseId?: string): LogLine | undefined {
  if (typeof value === "string") return fromNs("0", value, "unknown", releaseId);
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const ns = typeof value[0] === "number" ? String(value[0]) : String(value[0] ?? "");
  const payload = value[1];
  if (typeof payload !== "string") return undefined;
  try {
    const inner: unknown = JSON.parse(payload);
    if (isRecord(inner)) {
      const msg = [inner._entry, inner.message, inner.log].find((x) => typeof x === "string");
      return fromNs(ns, typeof msg === "string" ? msg : payload, toStream(inner.type), releaseId);
    }
  } catch {
    /* not JSON: plain line */
  }
  return fromNs(ns, payload, "unknown", releaseId);
}

function parseEntry(entry: unknown): LogLine[] {
  if (!isRecord(entry) || !Array.isArray(entry.values)) return [];
  const meta = isRecord(entry.metaData) ? entry.metaData : {};
  const releaseId = typeof meta.releaseId === "string" ? meta.releaseId : undefined;
  return entry.values.flatMap((v) => parseValue(v, releaseId) ?? []);
}

/**
 * Normalises every runtime-log shape seen so far into sorted `LogLine[]`.
 *  - v2 [CLI]: `{data:[{metaData:{releaseId},values:[[ns, '{"_entry":..,"type":..}']]}]}`
 *  - v1 [V spec]: `[{type, datetime, message}]`
 *  - plain strings / newline-separated text
 * Never throws: malformed lines are skipped.
 */
export function parseRuntimeLogs(raw: unknown): LogLine[] {
  let lines: LogLine[] = [];
  try {
    if (typeof raw === "string") {
      lines = raw.split(/\r?\n/).filter(Boolean).map((l) => fromNs("0", l, "unknown"));
    } else if (isRecord(raw) && Array.isArray(raw.data)) {
      lines = raw.data.flatMap(parseEntry);
    } else if (Array.isArray(raw)) {
      lines = raw.flatMap((item): LogLine[] => {
        if (typeof item === "string") return [fromNs("0", item, "unknown")];
        if (isRecord(item) && Array.isArray(item.values)) return parseEntry(item);
        if (isRecord(item) && typeof item.message === "string") {
          return [fromDate(item.datetime ?? item.timestamp, item.message, toStream(item.type))];
        }
        return [];
      });
    }
  } catch {
    return [];
  }
  // Groups in `data[]` are individually sorted but not globally [CLI].
  return lines.sort((a, b) => {
    const x = BigInt(a.tsNs);
    const y = BigInt(b.tsNs);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export interface RuntimeLogsQuery {
  /** Unix seconds to start from. */
  startSec: number;
  releaseId?: string;
  lastLines?: boolean;
  signal?: AbortSignal;
}

const v2Unavailable = new WeakSet<LiaraClient>();

/**
 * Runtime logs. Tries v2 [CLI] `GET /v2/projects/{name}/logs?start&direction=forward&last_lines[&releaseId]`;
 * if that endpoint is missing (404/405/501) falls back to v1 [V] `GET /v1/projects/{name}/logs?since=`
 * (unit of `since` unverified [VAL], seconds assumed) and remembers the choice for the client.
 */
export async function getRuntimeLogs(
  client: LiaraClient,
  name: string,
  q: RuntimeLogsQuery,
): Promise<{ lines: LogLine[]; source: "v2" | "v1" }> {
  const start = Math.max(0, Math.floor(q.startSec));
  if (!v2Unavailable.has(client)) {
    try {
      const raw = await client.get(`/v2/projects/${seg(name)}/logs`, z.unknown(), {
        query: { start, direction: "forward", last_lines: q.lastLines ?? false, releaseId: q.releaseId },
        signal: q.signal,
        timeoutMs: 20_000,
      });
      return { lines: parseRuntimeLogs(raw), source: "v2" };
    } catch (e) {
      if (!isLiaraError(e) || ![404, 405, 501].includes(e.status)) throw e;
      try {
        const raw = await client.get(`/v1/projects/${seg(name)}/logs`, z.unknown(), {
          query: { since: start },
          signal: q.signal,
          timeoutMs: 20_000,
        });
        v2Unavailable.add(client);
        return { lines: parseRuntimeLogs(raw), source: "v1" };
      } catch {
        throw e; // v1 failed too: report the original v2 error (e.g. a real "app not found")
      }
    }
  }
  const raw = await client.get(`/v1/projects/${seg(name)}/logs`, z.unknown(), {
    query: { since: start },
    signal: q.signal,
    timeoutMs: 20_000,
  });
  return { lines: parseRuntimeLogs(raw), source: "v1" };
}

export interface TailOptions {
  /** Unix seconds to start from (default: 60 s ago). */
  sinceSec?: number;
  releaseId?: string;
  signal?: AbortSignal;
  intervalMs?: number;
  /** Consecutive transient poll failures tolerated before the generator throws. */
  maxConsecutiveErrors?: number;
}

/**
 * Follow runtime logs by polling. The cursor is the last seen nanosecond
 * timestamp; the API only takes whole seconds, so each poll starts at that
 * second and lines are de-duplicated on `tsNs|stream|message`.
 */
export async function* tailRuntimeLogs(client: LiaraClient, name: string, opts: TailOptions = {}): AsyncGenerator<LogLine> {
  const { signal, intervalMs = 1500, maxConsecutiveErrors = 5 } = opts;
  let startSec = Math.floor(opts.sinceSec ?? Date.now() / 1000 - 60);
  let seen = new Set<string>();
  let failures = 0;
  while (!signal?.aborted) {
    try {
      const { lines } = await getRuntimeLogs(client, name, { startSec, releaseId: opts.releaseId, signal });
      failures = 0;
      const fresh: LogLine[] = [];
      for (const l of lines) {
        const key = `${l.tsNs}|${l.stream}|${l.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(l);
      }
      for (const l of fresh) yield l;
      const last = lines.at(-1);
      if (last && last.tsNs !== "0") {
        const nextStart = Number(BigInt(last.tsNs) / NS_PER_S);
        if (nextStart > startSec) {
          startSec = nextStart;
          const floorNs = BigInt(startSec) * NS_PER_S;
          seen = new Set([...seen].filter((k) => {
            const ns = BigInt(k.slice(0, k.indexOf("|")));
            return ns === ZERO || ns >= floorNs; // keep timestamp-less lines so they are never re-emitted
          }));
        }
      }
    } catch (e) {
      if (signal?.aborted) return;
      if (isLiaraError(e) && ["auth", "forbidden", "not_found"].includes(e.kind)) throw e;
      if (++failures > maxConsecutiveErrors) throw e;
    }
    await sleep(intervalMs, signal);
  }
}

/** Build output of a release [CLI]: `GET /v2/releases/{id}/build-logs?since=<createdAt of last line>`. */
export function getBuildLogs(
  client: LiaraClient,
  releaseId: string,
  opts: { since?: string; signal?: AbortSignal } = {},
): Promise<BuildLogsResponse> {
  return client.get(`/v2/releases/${seg(releaseId)}/build-logs`, BuildLogsResponseSchema, {
    query: { since: opts.since },
    signal: opts.signal,
  });
}

/** Identity of one build-output line: its `_id`, else time + text (the CLI de-duplicates the same way). */
export const buildLineKey = (l: { _id?: string; createdAt?: string; line?: string }): string => l._id ?? `${l.createdAt ?? ""}|${l.line ?? ""}`;

export interface BuildLogPagesOptions {
  signal?: AbortSignal;
  /** Pages requested at most (default 10). */
  maxPages?: number;
  /** Lines kept at most (default 2000; the first lines win: they hold the failing step). */
  maxLines?: number;
}

export interface BuildLogPages extends BuildLogsResponse {
  pages: number;
  /** True when a cap stopped the read or a later page failed: the output may be incomplete. */
  partial: boolean;
}

/**
 * Whole build output of a release. Liara returns ~20 lines per call; the next page is `?since=<createdAt of the
 * last line>` (same cursor as `watchRelease`). Lines are de-duplicated by `_id`; the read stops on an empty page,
 * a page without new lines or an unchanged cursor, and at `maxPages`/`maxLines`. A failure of the FIRST page
 * throws; a later failure returns what was read (`partial`). Abort always throws.
 */
export async function getBuildLogPages(client: LiaraClient, releaseId: string, opts: BuildLogPagesOptions = {}): Promise<BuildLogPages> {
  const maxPages = opts.maxPages ?? 10;
  const maxLines = opts.maxLines ?? 2000;
  const seen = new Set<string>();
  const out: BuildLogsResponse["buildOutput"] = [];
  let release: BuildLogsResponse["release"];
  let since: string | undefined;
  let pages = 0;
  let partial = false;
  while (pages < maxPages) {
    opts.signal?.throwIfAborted();
    let page: BuildLogsResponse;
    try {
      page = await getBuildLogs(client, releaseId, { since, signal: opts.signal });
    } catch (e) {
      if (pages === 0 || opts.signal?.aborted) throw e;
      partial = true;
      break;
    }
    pages++;
    release = page.release ?? release;
    let fresh = 0;
    for (const l of page.buildOutput) {
      const key = buildLineKey(l);
      if (seen.has(key)) continue;
      seen.add(key);
      if (out.length >= maxLines) {
        partial = true;
        break;
      }
      out.push(l);
      fresh++;
    }
    if (partial) break;
    const next = page.buildOutput.at(-1)?.createdAt;
    if (fresh === 0 || !next || next === since) break;
    since = next;
    if (pages >= maxPages) partial = true;
  }
  return { ...(release ? { release } : {}), buildOutput: out, pages, partial };
}
