// Temporal analysis: error onset (first error, change point on per-minute buckets) and correlation of
// onsets with releases, env changes and restarts. Pure.
import { isErrorLine } from "./lines";
import { draft, isSignature, toIso } from "./observe";
import { parseAccessLine } from "./extract/http-status";
import { ENV_CHANGE_EVENT } from "./extract/events";
import { RESTART_EVENT } from "./extract/crash";
import type { ChangeEvent, Correlation, DraftObservation, EvidenceLine, ExtractContext, TimelineEvent } from "./types";

/** Plan §4: "onset within 5 min of a release/config change". */
export const CORRELATION_WINDOW_SEC = 300;
/** Clock skew / log batching tolerance: an onset up to 60 s before the change still counts. */
export const CORRELATION_SKEW_SEC = 60;
/** Lifecycle restarts kept in the change list / timeline (newest). */
const MAX_LIFECYCLE_RESTARTS = 10;
export const TEMPORAL_SUMMARY = "evidence.temporal.onset_after_change";

/** A change with its interval: releases span createdAt..finishedAt, the rest are instants. */
export interface TimedChange extends ChangeEvent {
  startMs: number;
  endMs: number;
}

export function collectChanges(ctx: Pick<ExtractContext, "releases" | "events"> & Partial<Pick<ExtractContext, "lifecycle">>): TimedChange[] {
  const out: TimedChange[] = [];
  for (const r of ctx.releases) {
    const start = r.createdAt ? Date.parse(r.createdAt) : NaN;
    const end = r.finishedAt ? Date.parse(r.finishedAt) : NaN;
    const s = Number.isFinite(start) ? start : end;
    const e = Number.isFinite(end) ? end : start;
    if (!Number.isFinite(s)) continue;
    out.push({ kind: "release", ts: new Date(e).toISOString(), startMs: s, endMs: e, releaseTag: r.tag, releaseId: r.id, ...(r.state ? { state: r.state.toUpperCase() } : {}) });
  }
  for (const l of ctx.events) {
    if (l.ms === undefined) continue;
    const kind = ENV_CHANGE_EVENT.test(l.message) ? "env_change" : RESTART_EVENT.test(l.message) ? "restart" : undefined;
    if (kind) out.push({ kind, ts: new Date(l.ms).toISOString(), startMs: l.ms, endMs: l.ms });
  }
  // Container lifecycle: a `restart` action, or a `start` right after a die/kill/oom/stop, is a restart (timeline only; see correlate()).
  const life = ctx.lifecycle ?? [];
  const restarts = life.filter((e, i) => {
    if (e.action === "restart") return true;
    const prev = e.action === "start" ? life.slice(0, i).reverse().find((p) => p.action !== "create") : undefined;
    return prev !== undefined && ["die", "kill", "oom", "stop"].includes(prev.action);
  });
  for (const e of restarts.slice(-MAX_LIFECYCLE_RESTARTS)) {
    out.push({ kind: "restart", ts: new Date(e.ts).toISOString(), startMs: e.ts, endMs: e.ts, ...(e.tag ? { releaseTag: e.tag } : {}), ...(e.releaseId ? { releaseId: e.releaseId } : {}) });
  }
  return out.sort((a, b) => a.endMs - b.endMs || a.kind.localeCompare(b.kind));
}

export interface Onset {
  firstErrorTs?: string;
  changePointTs?: string;
  onsetTs?: string;
  onsetSource?: "change_point" | "first_error";
  /** Errors already present in the first bucket: the real onset may precede the window. */
  atWindowStart: boolean;
  buckets: number[];
  /** Release that wrote the onset line (runtime logs carry it); scopes the release correlation. */
  releaseId?: string;
}

const isOnsetError = (l: EvidenceLine) => isErrorLine(l.message) || (parseAccessLine(l.message)?.status ?? 0) >= 500;

/**
 * First error and error-rate change point. Buckets are `bucketSec` wide over [now-window, now]. The change
 * point is the split k maximising mean(after)-mean(before), accepted only when after >= 1/bucket,
 * after >= 3x before and at least 3 errors follow it. Ties resolve to the earliest k (deterministic).
 */
export function detectOnset(lines: readonly EvidenceLine[], now: number, windowMin: number, bucketSec = 60): Onset {
  const start = now - windowMin * 60_000;
  const n = Math.max(1, Math.ceil((windowMin * 60) / bucketSec));
  const buckets = new Array<number>(n).fill(0);
  let first: number | undefined;
  const errorMs: number[] = [];
  for (const l of lines) {
    if (l.ms === undefined || !isOnsetError(l)) continue;
    errorMs.push(l.ms);
    if (first === undefined || l.ms < first) first = l.ms;
    const i = Math.floor((l.ms - start) / (bucketSec * 1000));
    if (i >= 0 && i < n) buckets[i]++;
  }
  if (first === undefined) return { atWindowStart: false, buckets };

  let bestK = -1;
  let bestScore = 0;
  const total = buckets.reduce((a, b) => a + b, 0);
  let before = 0;
  for (let k = 1; k < n; k++) {
    before += buckets[k - 1];
    const after = total - before;
    const mb = before / k;
    const ma = after / (n - k);
    if (after >= 3 && ma >= 1 && ma >= 3 * mb && ma - mb > bestScore) {
      bestScore = ma - mb;
      bestK = k;
    }
  }
  const firstErrorTs = new Date(first).toISOString();
  const releaseAt = (ms: number) => lines.find((l) => l.ms === ms && isOnsetError(l))?.releaseId;
  if (bestK > 0) {
    const cpMs = start + bestK * bucketSec * 1000;
    const onsetMs = Math.min(...errorMs.filter((m) => m >= cpMs));
    const rel = releaseAt(onsetMs);
    return {
      firstErrorTs,
      changePointTs: new Date(cpMs).toISOString(),
      onsetTs: new Date(onsetMs).toISOString(),
      onsetSource: "change_point",
      atWindowStart: false,
      buckets,
      ...(rel ? { releaseId: rel } : {}),
    };
  }
  const rel = releaseAt(first);
  return { firstErrorTs, onsetTs: firstErrorTs, onsetSource: "first_error", atWindowStart: buckets[0] > 0, buckets, ...(rel ? { releaseId: rel } : {}) };
}

/** Releases that never served traffic: a runtime onset without a release id cannot be "after" them. */
const NEVER_SERVED = /^(?:FAILED|CANCEL+ED|TIMEDOUT)$/i;

/**
 * Can `c` explain an onset at `onset`? Env changes always can. A release can only when the onset line belongs to
 * that release and is not older than its creation; without a release id (v1 logs) any release that actually served
 * traffic can (within the usual skew).
 */
function mayExplain(c: TimedChange, onset: number, releaseId: string | undefined): boolean {
  if (c.kind !== "release") return true;
  if (releaseId) return c.releaseId === releaseId && onset >= c.startMs;
  return !NEVER_SERVED.test(c.state ?? "");
}

/** Is `ms` within the correlation window of change `c`? */
export function withinWindow(ms: number, c: TimedChange): boolean {
  return ms >= c.startMs - CORRELATION_SKEW_SEC * 1000 && ms <= c.endMs + CORRELATION_WINDOW_SEC * 1000;
}

/**
 * Correlates an onset with the latest release/env change that precedes it (within skew). Restarts are
 * reported in the timeline but are not a "change" for evidence levels (a crash loop causes its own restarts).
 */
export function correlate(onsetTs: string | undefined, changes: readonly TimedChange[], releaseId?: string): Correlation | undefined {
  const onset = onsetTs ? Date.parse(onsetTs) : NaN;
  if (!Number.isFinite(onset)) return undefined;
  const candidates = changes.filter((c) => c.kind !== "restart" && c.startMs - CORRELATION_SKEW_SEC * 1000 <= onset && mayExplain(c, onset, releaseId));
  if (!candidates.length) return undefined;
  // Prefer a change whose window contains the onset; else the most recent one before it.
  const inWindow = candidates.filter((c) => withinWindow(onset, c));
  const pick = (inWindow.length ? inWindow : candidates).reduce((a, b) => (b.endMs >= a.endMs ? b : a));
  const deltaSec = Math.round((onset - pick.endMs) / 1000);
  return {
    ...(pick.releaseTag ? { withReleaseTag: pick.releaseTag } : {}),
    changeKind: pick.kind,
    changeTs: pick.ts,
    onsetTs: new Date(onset).toISOString(),
    deltaSec,
    within5min: withinWindow(onset, pick),
  };
}

function temporalDraft(c: Correlation, change: TimedChange | undefined, onsetSource: string): DraftObservation {
  return draft("event", c.changeKind === "release" ? "liara:releases" : "liara:events", TEMPORAL_SUMMARY, "info",
    `onset ${c.onsetTs} vs ${c.changeKind} ${c.withReleaseTag ?? ""} at ${c.changeTs} (Δ ${c.deltaSec}s)`.replace(/\s+/g, " "),
    {
      onsetTs: c.onsetTs,
      onsetSource,
      changeKind: c.changeKind,
      changeTs: c.changeTs,
      changeStartTs: change ? new Date(change.startMs).toISOString() : c.changeTs,
      releaseTag: c.withReleaseTag,
      deltaSec: c.deltaSec,
      within5min: c.within5min,
    }, c.onsetTs);
}

/**
 * Temporal observations: one for the global onset, plus one per further change that some signature
 * observation's first occurrence falls into. Deduplicated by change, chronological.
 */
export function temporalObservations(drafts: readonly DraftObservation[], changes: readonly TimedChange[], onset: Onset): DraftObservation[] {
  const byChange = new Map<string, DraftObservation>();
  const keyOf = (c: Correlation) => `${c.changeKind}|${c.changeTs}`;
  const findChange = (c: Correlation) => changes.find((x) => x.kind === c.changeKind && x.ts === c.changeTs);
  const global = correlate(onset.onsetTs, changes, onset.releaseId);
  if (global) byChange.set(keyOf(global), temporalDraft(global, findChange(global), onset.onsetSource ?? "first_error"));
  const sigs = drafts
    .filter((d) => isSignature(d) && d.ts)
    .map((d) => ({ ts: d.ts as string, releaseId: typeof d.params.releaseId === "string" ? d.params.releaseId : undefined }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  for (const { ts, releaseId } of sigs) {
    const c = correlate(ts, changes, releaseId);
    if (!c?.within5min || byChange.has(keyOf(c))) continue;
    byChange.set(keyOf(c), temporalDraft(c, findChange(c), "signature"));
  }
  return [...byChange.values()].sort((a, b) => String(a.params.changeTs).localeCompare(String(b.params.changeTs)));
}

/** Chronological timeline of changes, onsets, OOM kills and the probe. */
export function buildTimeline(ctx: ExtractContext, changes: readonly TimedChange[], onset: Onset, drafts: readonly DraftObservation[]): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  for (const r of ctx.releases) {
    const c = toIso(r.createdAt);
    const f = toIso(r.finishedAt);
    const params = { ...(r.tag ? { tag: r.tag } : {}), ...(r.state ? { state: r.state } : {}) };
    if (c) ev.push({ ts: c, kind: "release_created", label: "timeline.release_created", ...(r.id ? { ref: r.id } : {}), params });
    if (f) ev.push({ ts: f, kind: "release_finished", label: "timeline.release_finished", ...(r.id ? { ref: r.id } : {}), params });
  }
  for (const c of changes) {
    if (c.kind === "env_change") ev.push({ ts: c.ts, kind: "env_change", label: "timeline.env_change" });
    if (c.kind === "restart") ev.push({ ts: c.ts, kind: "restart", label: "timeline.restart" });
  }
  if (onset.firstErrorTs) ev.push({ ts: onset.firstErrorTs, kind: "first_error", label: "timeline.first_error" });
  if (onset.changePointTs) ev.push({ ts: onset.changePointTs, kind: "error_onset", label: "timeline.error_rate_change" });
  for (const d of drafts) {
    if (d.kind === "oom" && d.ts) ev.push({ ts: d.ts, kind: "oom_kill", label: "timeline.oom", params: { kills: d.params.kills ?? 1 } });
  }
  if (ctx.probe?.checkedAt) {
    const ts = toIso(ctx.probe.checkedAt);
    if (ts) ev.push({ ts, kind: "probe", label: "timeline.probe", params: { ...(ctx.probe.status ? { status: ctx.probe.status } : {}), latencyMs: ctx.probe.latencyMs } });
  }
  // Dedupe identical entries (same restart line twice) and order by time, then kind.
  const seen = new Set<string>();
  return ev
    .filter((e) => {
      const k = `${e.ts}|${e.kind}|${e.ref ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.kind.localeCompare(b.kind));
}
