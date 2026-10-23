// App runtime verification: wait (bounded, with backoff) for running applets on a READY release, then 3 HTTP
// probes >= 5 s apart expecting 2xx, then the logs since the change must not show the originating error signature.
// "Fixed" is never inferred from API acceptance: each step is an observation of the real app.
//
// Liara's `/applets` answers 500 for some apps (live 2026-10-23, persistent). Without it:
//  app_running      comes from the app detail (status ACTIVE/RUNNING, scale >= 1, deployed) + the release state
//                   READY, disclosed "(via app detail)"; failed only on contradicting evidence (another status,
//                   scale 0, not deployed, a release that is not READY at the deadline or FAILED/UNHEALTHY/...);
//                   unknown when the app or release reads themselves fail.
//  restart_observed comes from Liara's container events: a create/start/restart event in a second strictly after
//                   the execution's second, disclosed "(via events)"; otherwise unknown (never assumed).
import {
  getApp,
  getRuntimeLogs,
  listApplets,
  listLifecycleEvents,
  listReleases,
  type Applet,
  type AppDetail,
  type AppLifecycleEvent,
  type LiaraClient,
  type Release,
} from "@/lib/liara";
import type { Snapshot } from "@/lib/contracts/proposal";
import { VERIFY_BASIS_MARKERS } from "@/lib/contracts/verification-basis";
import { isNotFound } from "./liara-refs";
import { matchesSignature, signatureId, type ErrorSignature } from "./signatures";
import { isAppletRunning } from "./snapshot";
import { pollUntil, type Checks, type Clock, type ProbeFn } from "./verify-support";

export interface VerifyEnv {
  liara: LiaraClient;
  clock: Clock;
  signal?: AbortSignal;
  deadline: number;
  pollMs: number;
  /** Epoch ms of the mutation: the log window starts here. */
  executedAt: number;
  before?: Snapshot;
}

export interface AppExpectations {
  /** Running instances must be new ones (names unseen before, or started after the change). */
  expectRestart: boolean;
  /** A release newer than the one before must become current and READY (redeploy). */
  expectNewRelease: boolean;
  scale?: 0 | 1;
  planId?: string;
}

interface AppState {
  /** undefined = the instance list could not be read (optional signal: verification continues without it). */
  applets?: Applet[];
  /** Error kind of the failed applets read (a short token, never a message). */
  appletsError?: string;
  newest?: Release;
  current?: Release;
  currentId?: string;
  /** Set when the release list could not be read (only tolerated while the instance list is unavailable). */
  releasesError?: string;
  app?: AppDetail;
  /** Set when the app detail could not be read (only tolerated while the instance list is unavailable). */
  appError?: string;
  /** Container lifecycle events; read only when the instance list is unavailable and a restart is expected. */
  events?: AppLifecycleEvent[];
  eventsError?: string;
}

const READY = /^ready$/i;
const BAD_RELEASE = /^(?:failed|canceled|cancelled|timedout|unhealthy)$/i;
/** App statuses Liara reports for a serving app ("RUNNING" recorded 2026-10-22, "ACTIVE" live 2026-10-23). */
const APP_STATUS_RUNNING = /^(?:running|ready|active)$/i;
/** Lifecycle events that put a (new) container in place. `die` alone is not a restart; die-then-start is. */
const RESTART_EVENT = /^(?:create|start|restart)$/;
/** Without the instance list: once the app looks healthy, wait at most this long for a restart event to show up. */
export const RESTART_EVENT_GRACE_MS = 20_000;
/** Poll backoff of the runtime wait: 3 s, 4.5 s, 6.75 s, ... capped here (the overall timeout still applies). */
const POLL_BACKOFF = { factor: 1.5, maxMs: 10_000 };
const MAX_LOG_LINES = 5000;
const MAX_LINE_CHARS = 2000;

const startedAfter = (ts: string | undefined, ms: number) => {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) && t > ms;
};

const errKind = (e: unknown) => {
  const kind = (e as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" && /^[a-z_]{1,32}$/.test(kind) ? kind : "error";
};

function releaseFields(page: Awaited<ReturnType<typeof listReleases>>): Pick<AppState, "newest" | "current" | "currentId"> {
  const newest = page.releases[0];
  const current = page.releases.find((r) => page.currentRelease !== undefined && r._id === page.currentRelease) ?? newest;
  return { newest, current, currentId: page.currentRelease };
}

/**
 * The instance list is an optional signal: Liara's `/applets` is known to answer 500 for some apps. When it fails,
 * the app detail (status, scale, deployed) and, if a restart is expected, the container events are read instead;
 * a failed app/release read is then recorded (unknown), not thrown, unless every read failed or the app is gone.
 */
async function readAppState(liara: LiaraClient, app: string, opts: { needDetail: boolean; wantEvents: boolean; signal?: AbortSignal }): Promise<AppState> {
  const [appletsR, page, detailR] = await Promise.allSettled([
    listApplets(liara, app),
    listReleases(liara, app, { page: 1, count: 5 }),
    opts.needDetail ? getApp(liara, app) : Promise.resolve(undefined),
  ]);
  if (appletsR.status === "fulfilled") {
    // Instance list available: releases and a requested app detail are required reads (their failure fails the read).
    if (page.status === "rejected") throw page.reason;
    if (detailR.status === "rejected") throw detailR.reason;
    return { applets: appletsR.value, ...releaseFields(page.value), app: detailR.value };
  }
  const [detail, eventsR] = await Promise.allSettled([
    detailR.status === "rejected" ? Promise.reject(detailR.reason) : detailR.value !== undefined ? Promise.resolve(detailR.value) : getApp(liara, app),
    opts.wantEvents ? listLifecycleEvents(liara, app, opts.signal) : Promise.resolve(undefined),
  ]);
  // A gone app is definitive; everything unreadable means the state could not be read at all.
  if (page.status === "rejected" && isNotFound(page.reason)) throw page.reason;
  if (detail.status === "rejected" && isNotFound(detail.reason)) throw detail.reason;
  if (page.status === "rejected" && detail.status === "rejected") throw page.reason;
  return {
    appletsError: errKind(appletsR.reason),
    ...(page.status === "fulfilled" ? releaseFields(page.value) : { releasesError: errKind(page.reason) }),
    ...(detail.status === "fulfilled" ? { app: detail.value } : { appError: errKind(detail.reason) }),
    ...(eventsR.status === "fulfilled" ? (eventsR.value ? { events: eventsR.value } : {}) : { eventsError: errKind(eventsR.reason) }),
  };
}

/** Records that the (optional) instance list could not be read; never a pass, never blocking by itself. */
function noteAppletsUnavailable(s: AppState, checks: Checks): void {
  if (s.applets !== undefined) return;
  checks.record(
    "applets_available",
    "unknown",
    `the instance list (applets) was unavailable (${s.appletsError ?? "error"}): running instances and restarts were not observed through it; the remaining signals were used`,
    { signal: "state" },
  );
}

/**
 * Returns whether the app ended up running and, when observed, the restart moment (epoch ms): the newest start time
 * of the fresh instances, or the time of the restart event. It starts the decisive log window.
 */
export interface RuntimeResult {
  running: boolean;
  /** Observed restart moment (epoch ms); undefined when no restart was observed. */
  restartAt?: number;
  /** Time resolution of `restartAt`: 1000 for a Liara event (whole seconds), 1 for an instance start time. */
  restartResolutionMs?: number;
  /** Current release id at the app_running decision (the release in force after the change). */
  currentReleaseId?: string;
}

export async function verifyAppRuntime(env: VerifyEnv, app: string, exp: AppExpectations, checks: Checks): Promise<RuntimeResult> {
  const names = typeof env.before?.appletNames === "string" && env.before.appletNames ? env.before.appletNames.split(",") : [];
  const beforeNames = new Set(names);
  // Freshness: by instance names when the before-snapshot recorded them; otherwise only start times after the
  // change can prove a restart. Neither available => the restart could not be observed (never assumed).
  const freshnessByNames = exp.expectRestart && beforeNames.size > 0;
  const beforeLatest = typeof env.before?.latestReleaseId === "string" && env.before.latestReleaseId ? env.before.latestReleaseId : undefined;
  // Events carry whole unix seconds: only a second strictly after the execution's second is provably after it.
  const eventsFrom = (Math.floor(env.executedAt / 1000) + 1) * 1000;

  const evaluate = (s: AppState) => {
    const appletsKnown = s.applets !== undefined;
    const running = (s.applets ?? []).filter(isAppletRunning);
    const newRelease =
      !exp.expectNewRelease ||
      (beforeLatest !== undefined ? s.newest?._id !== undefined && s.newest._id !== beforeLatest : startedAfter(s.newest?.createdAt, env.executedAt));
    const releaseForReadiness = exp.expectNewRelease ? s.newest : s.current;
    const relState = releaseForReadiness?.state;
    const ready = READY.test(relState ?? "") && (!exp.expectNewRelease || s.currentId === undefined || s.currentId === s.newest?._id);
    const badRelease = exp.expectNewRelease && newRelease && BAD_RELEASE.test(s.newest?.state ?? "");
    // The release that should be serving ended in a terminal bad state: stable, no reason to keep polling.
    const releaseBad = BAD_RELEASE.test(relState ?? "") && (!exp.expectNewRelease || newRelease);

    // app_running: from the instance list when readable; otherwise from the app detail + release state.
    let verdict: "passed" | "failed" | "unknown";
    const contradictions: string[] = [];
    const unreadable: string[] = [];
    if (appletsKnown) {
      verdict = s.applets!.length > 0 && running.length === s.applets!.length && ready ? "passed" : "failed";
    } else {
      if (!s.app) unreadable.push(`app detail (${s.appError ?? "error"})`);
      else {
        const st = s.app.status;
        if (!st) unreadable.push("app status");
        else if (!APP_STATUS_RUNNING.test(st)) contradictions.push(`app status ${st}`);
        if (s.app.scale === undefined) unreadable.push("scale");
        else if (s.app.scale < 1) contradictions.push(`scale ${s.app.scale}`);
        if (s.app.isDeployed === false) contradictions.push("the app is not deployed");
      }
      if (s.releasesError !== undefined) unreadable.push(`release list (${s.releasesError})`);
      else if (!releaseForReadiness) contradictions.push("no release");
      else if (!ready) contradictions.push(`release ${relState ?? "unknown"}`);
      verdict = contradictions.length > 0 ? "failed" : unreadable.length > 0 ? "unknown" : "passed";
    }

    const freshByApplets =
      appletsKnown &&
      running.length > 0 &&
      running.every((a) => (freshnessByNames && !beforeNames.has(a.name ?? "")) || startedAfter(a.timestamp, env.executedAt));
    // Without the instance list, the newest create/start/restart event after the execution is the restart witness.
    const restartEvent = appletsKnown
      ? undefined
      : (s.events ?? []).filter((ev) => RESTART_EVENT.test(ev.action) && ev.ts >= eventsFrom).sort((a, b) => b.ts - a.ts)[0];
    const fresh = !exp.expectRestart || freshByApplets || restartEvent !== undefined;
    const scaleOk = exp.scale === undefined || s.app?.scale === exp.scale;
    const planOk = exp.planId === undefined || s.app?.planID === exp.planId;
    return { appletsKnown, running, verdict, contradictions, unreadable, ready, newRelease, badRelease, releaseBad, freshByApplets, restartEvent, fresh, scaleOk, planOk, state: relState };
  };

  const needDetail = exp.scale !== undefined || exp.planId !== undefined;
  let healthySince: number | undefined;
  const r = await pollUntil(
    env.clock,
    env.deadline,
    env.pollMs,
    env.signal,
    () => readAppState(env.liara, app, { needDetail, wantEvents: exp.expectRestart, signal: env.signal }),
    (s) => {
      const e = evaluate(s);
      if (e.badRelease || e.releaseBad) return true;
      const healthy = e.verdict === "passed" && e.newRelease && e.scaleOk && e.planOk;
      if (!healthy) {
        healthySince = undefined;
        return false;
      }
      healthySince ??= env.clock.now();
      if (e.fresh) return true;
      // Instance list readable: the old instances may still be replaced, keep waiting (up to the deadline).
      if (e.appletsKnown) return false;
      // Events are the only restart witness left: give them a bounded grace once the app looks healthy.
      return env.clock.now() - healthySince >= RESTART_EVENT_GRACE_MS;
    },
    { backoff: POLL_BACKOFF },
  );

  if (!r.last) {
    if (r.lastErrorKind === "not_found") checks.add("resource_exists", false, "the app was not found", true);
    else checks.add("state_readable", false, `app state could not be read (${r.lastErrorKind ?? "error"})`, true);
    return { running: false };
  }
  const last = r.last;
  const e = evaluate(last);
  const state = { signal: "state" as const };
  noteAppletsUnavailable(last, checks);
  if (exp.expectNewRelease) {
    const detail = `newest release ${last.newest?._id ?? "none"} is ${last.newest?.state ?? "unknown"}`;
    if (!e.newRelease && beforeLatest === undefined) {
      checks.record("new_release", "unknown", `${detail}; the release before the change was not recorded, so a new release could not be told apart`, { ...state, required: true });
    } else {
      checks.add("new_release", e.newRelease && e.ready, detail, { ...state, required: true, fatal: e.badRelease });
    }
  }
  // A FAILED/UNHEALTHY/... serving release is a definitive contradiction (new_release already carries it on redeploy).
  const runningOpts = { ...state, required: true, fatal: e.releaseBad && !exp.expectNewRelease };
  if (e.appletsKnown) {
    checks.add("app_running", e.verdict === "passed", `applets running ${e.running.length}/${last.applets!.length}, release ${e.state ?? "none"}`, runningOpts);
  } else {
    const app = last.app;
    let detail =
      `app status ${app?.status ?? "unknown"}, scale ${app?.scale ?? "unknown"}, deployed ${app?.isDeployed ?? "unknown"}, release ${last.releasesError ? "unreadable" : (e.state ?? "none")}; ` +
      `the instance list was unavailable, so this was read from the app detail and the release state ${VERIFY_BASIS_MARKERS.appDetail}`;
    if (e.verdict === "failed") detail += `; contradicting: ${e.contradictions.join(", ")}`;
    else if (e.verdict === "unknown") detail += `; could not be read: ${e.unreadable.join(", ")}`;
    checks.record("app_running", e.verdict, detail, runningOpts);
  }
  if (exp.expectRestart) {
    if (e.freshByApplets) {
      checks.add(
        "restart_observed",
        true,
        freshnessByNames ? "new instances replaced the previous ones" : "every running instance started after the change",
        { ...state, required: true },
      );
    } else if (!e.appletsKnown) {
      if (e.restartEvent) {
        checks.add(
          "restart_observed",
          true,
          `a container "${e.restartEvent.action}" event at ${new Date(e.restartEvent.ts).toISOString()} after the change was seen in Liara's events ${VERIFY_BASIS_MARKERS.events}; the instance list (applets) was unavailable`,
          { ...state, required: true },
        );
      } else if (last.eventsError !== undefined) {
        checks.record(
          "restart_observed",
          "unknown",
          `the restart could not be observed: the instance list (applets) was unavailable and Liara's events could not be read (${last.eventsError})`,
          { ...state, required: true },
        );
      } else {
        const evs = last.events ?? [];
        const latest = evs.reduce<number | undefined>((m, ev) => (m === undefined || ev.ts > m ? ev.ts : m), undefined);
        checks.record(
          "restart_observed",
          "unknown",
          `the restart could not be observed: the instance list (applets) was unavailable and Liara's events show no container start after the change (${evs.length} events, latest ${latest !== undefined ? new Date(latest).toISOString() : "none"})`,
          { ...state, required: true },
        );
      }
    } else if (freshnessByNames) {
      checks.add("restart_observed", false, "the previous instances were still serving at the deadline", { ...state, required: true });
    } else {
      checks.record(
        "restart_observed",
        "unknown",
        "the restart could not be observed: the instances before the change were not recorded and no running instance shows a start time after it",
        { ...state, required: true },
      );
    }
  }
  if (exp.scale !== undefined) checks.add("scale_applied", e.scaleOk, `scale is ${last.app?.scale ?? "unknown"}`, { ...state, required: true });
  if (exp.planId !== undefined) checks.add("plan_applied", e.planOk, `plan is ${last.app?.planID ?? "unknown"}`, { ...state, required: true });
  // The restart moment: newest start of the fresh instances, else the restart event (whole seconds, floored).
  const appletStarts = e.freshByApplets ? e.running.map((a) => (a.timestamp ? Date.parse(a.timestamp) : NaN)).filter((t) => Number.isFinite(t) && t > env.executedAt) : [];
  const byApplets = appletStarts.length > 0;
  const restartAt = byApplets ? Math.max(...appletStarts) : e.restartEvent?.ts;
  const currentReleaseId = last.currentId ?? last.current?._id;
  return {
    running: e.verdict === "passed",
    ...(restartAt !== undefined ? { restartAt, restartResolutionMs: byApplets ? 1 : 1000 } : {}),
    ...(currentReleaseId ? { currentReleaseId } : {}),
  };
}

/** Stop (scale 0): no running instance remains and the app reports scale 0. */
export async function verifyAppStopped(env: VerifyEnv, app: string, checks: Checks): Promise<void> {
  const r = await pollUntil(env.clock, env.deadline, env.pollMs, env.signal, () => readAppState(env.liara, app, { needDetail: true, wantEvents: false, signal: env.signal }), (s) =>
    s.app?.scale === 0 && !(s.applets ?? []).some(isAppletRunning),
  );
  if (!r.last) {
    checks.add("state_readable", false, `app state could not be read (${r.lastErrorKind ?? "error"})`, true);
    return;
  }
  noteAppletsUnavailable(r.last, checks);
  const running = r.last.applets === undefined ? "unknown (instance list unavailable)" : String(r.last.applets.filter(isAppletRunning).length);
  checks.add("app_stopped", r.ok, `scale is ${r.last.app?.scale ?? "unknown"}, running instances ${running}`, { signal: "state", required: true });
}

export interface ProbeSeries {
  ok: boolean;
  /** Every attempt in order (status code or error token). */
  results: string[];
  /** Milliseconds from the first to the last attempt. */
  spanMs: number;
}

/** Hard cap on probe attempts, whatever window is configured. */
const MAX_PROBE_ATTEMPTS = 40;

/**
 * Settling probe window: probe every `gapMs` (>= 5 s); passes as soon as `count` CONSECUTIVE attempts answered 2xx.
 * A rolling restart may keep the old (broken) instance serving for a few seconds, so early non-2xx answers do not
 * fail the check by themselves; the window (`windowMs`, hard-capped at MAX_PROBE_ATTEMPTS attempts) ends without
 * `count` consecutive 2xx => failed, and it stops early once the streak can no longer be reached. `windowMs` 0 =
 * exactly `count` attempts (used when an earlier check already failed definitively). `probe === null` = non-web app.
 */
export async function probeChecks(
  env: VerifyEnv,
  app: string,
  probe: ProbeFn | null,
  count: number,
  gapMs: number,
  checks: Checks,
  windowMs = 0,
): Promise<ProbeSeries | undefined> {
  if (probe === null) {
    checks.record("probe_skipped", "skipped", "non-web app: HTTP checks were not performed");
    return undefined;
  }
  const maxAttempts = Math.min(MAX_PROBE_ATTEMPTS, Math.max(count, gapMs > 0 ? Math.floor(windowMs / gapMs) + 1 : count));
  const results: string[] = [];
  let streak = 0;
  let firstAt = 0;
  let lastAt = 0;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await env.clock.sleep(gapMs, env.signal);
    if (env.signal?.aborted) {
      checks.add("probe_2xx", false, `verification was aborted before the probes settled${results.length ? ` (${results.join(", ")})` : ""}`, { signal: "probe" });
      return undefined;
    }
    let status: number | undefined;
    let error: string | undefined;
    try {
      const r = await probe(env.liara, app);
      status = r.status;
      error = r.error;
    } catch {
      error = "unknown";
    }
    if (i === 0 && error === "no_url") {
      checks.record("probe_skipped", "skipped", "the app has no public address (default subdomain off, no active custom domain): HTTP checks were not performed");
      return undefined;
    }
    lastAt = env.clock.now();
    if (i === 0) firstAt = lastAt;
    const twoXx = status !== undefined && status >= 200 && status < 300;
    streak = twoXx ? streak + 1 : 0;
    results.push(status !== undefined ? String(status) : (error ?? "error"));
    if (streak >= count) break;
    // The answer can no longer change: not enough attempts left to complete a streak.
    if (streak + (maxAttempts - i - 1) < count) break;
  }
  const ok = streak >= count;
  const spanMs = lastAt - firstAt;
  const span = `${results.join(", ")} over ${Math.round(spanMs / 1000)} s`;
  const gap = `${Math.round(gapMs / 1000)} s apart`;
  checks.add(
    "probe_2xx",
    ok,
    ok
      ? `${span}: ${count} consecutive 2xx, ${gap}`
      : `${span}: never ${count} consecutive 2xx ${gap} (${results.length} attempts, window ${Math.round(windowMs / 1000)} s)`,
    { signal: "probe" },
  );
  return { ok, results, spanMs };
}

/**
 * set_env before/after contrast: the probe failed (5xx) before the change and the settling probes ended with the
 * required consecutive 2xx. Disclosed as its own passed check of the SAME source as probe_2xx ("probe"), so it
 * never adds an independent signal and never stands in for a required check.
 */
export function recordBeforeAfterContrast(beforeStatus: number | undefined, after: ProbeSeries | undefined, checks: Checks): void {
  if (beforeStatus === undefined || !after?.ok || after.results.length === 0) return;
  checks.add(
    "behavior_changed",
    true,
    `behaviour changed from ${beforeStatus} to 2xx: the probe failed before the change and answers 2xx after it (attempts: ${after.results.join(", ")}) ${VERIFY_BASIS_MARKERS.contrast}; it does not replace any required check`,
    { signal: "probe" },
  );
}

const fmt = (m: Map<string, number>) => [...m].map(([k, n]) => `${k} x${n}`).join(", ");

type LogLines = Awaited<ReturnType<typeof getRuntimeLogs>>["lines"];

const lineTime = (line: LogLines[number]): number | undefined => {
  if (line.tsNs === "0") return undefined;
  const t = Date.parse(line.ts);
  return Number.isFinite(t) ? t : undefined;
};

const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

export interface LogWindow {
  /** Observed restart moment (epoch ms) and its resolution (1000 = a whole-second Liara event). */
  restartAt?: number;
  restartResolutionMs?: number;
  /** Release in force before the change (before-snapshot) and after it (re-read at check time). */
  beforeReleaseId?: string;
  afterReleaseId?: string;
}

/**
 * The originating error must not recur in the NEW process's output. Attribution, most precise first:
 *  release  when the change put a new release in force (before != after) and a line carries its group's
 *           `metaData.releaseId`: only lines of the new release are decisive; lines of previous releases (the old
 *           container during a rolling restart) are counted and reported as ignored;
 *  time     otherwise: a line is decisive only when it is STRICTLY after the restart moment at its resolution
 *           (for a whole-second event: after that second). Lines in the restart second are ambiguous: reported,
 *           never counted for pass or fail. Lines before the restart are reported as ignored. Without an observed
 *           restart the execution start is the boundary (no ambiguity).
 *  passed  >= 1 decisive timestamped line and no signature match among the decisive lines;
 *  failed  a signature matched in a decisive line (untimed lines count here: they cannot be placed before it);
 *  unknown no decisive line (an empty window proves nothing) or the logs could not be read.
 * No log text is ever reported.
 */
export async function logSignatureCheck(
  env: VerifyEnv,
  app: string,
  signatures: readonly ErrorSignature[],
  window: LogWindow,
  checks: Checks,
  required = false,
): Promise<void> {
  const ids = signatures.map(signatureId);
  const opts = { signal: "logs" as const, required };
  const restartAt = window.restartAt !== undefined && window.restartAt > env.executedAt ? window.restartAt : undefined;
  const resolution = restartAt !== undefined ? Math.max(1, window.restartResolutionMs ?? 1000) : 0;
  const boundary = restartAt ?? env.executedAt;
  const releaseMode = window.afterReleaseId !== undefined && window.beforeReleaseId !== undefined && window.afterReleaseId !== window.beforeReleaseId;
  const read = async (ms: number): Promise<LogLines> => {
    const lines = (await getRuntimeLogs(env.liara, app, { startSec: Math.floor(ms / 1000), signal: env.signal })).lines;
    return Array.isArray(lines) ? lines.slice(-MAX_LOG_LINES) : [];
  };
  // One read from the execution start shows the earlier lines; when the restart is in a later second, a second
  // read starting at the restart's second guarantees the decisive lines are not cut off by a capped page.
  const splitSec = Math.floor(boundary / 1000) * 1000;
  const separate = splitSec > Math.floor(env.executedAt / 1000) * 1000;
  const [preR, postR] = await Promise.allSettled([read(env.executedAt), separate ? read(splitSec) : Promise.resolve(undefined)]);
  const postRead = separate ? postR : preR;
  if (postRead.status === "rejected" || postRead.value === undefined) {
    const e = postRead.status === "rejected" ? postRead.reason : undefined;
    const kind = (e as { kind?: unknown } | null)?.kind;
    checks.record("error_signature_absent", "unknown", `logs unavailable (${typeof kind === "string" ? kind : "error"}): the absence of ${ids.join(", ")} could not be checked`, opts);
    return;
  }
  // Merge without duplicates: earlier seconds from the first read, the restart second onward (and untimed lines)
  // from the second one.
  const lines: LogLines = separate
    ? [
        ...(preR.status === "fulfilled" ? preR.value.filter((l) => { const t = lineTime(l); return t !== undefined && t < splitSec; }) : []),
        ...postRead.value.filter((l) => { const t = lineTime(l); return t === undefined || t >= splitSec; }),
      ]
    : postRead.value;
  const earlyUnreadable = separate && preR.status === "rejected";

  const match = (line: LogLines[number], bucket: Map<string, number>) => {
    // Same bound as the evidence engine: hostile multi-megabyte lines never reach the parsers whole.
    const message = line.message.length > MAX_LINE_CHARS ? line.message.slice(0, MAX_LINE_CHARS) : line.message;
    for (const s of signatures) if (matchesSignature(s, message)) bucket.set(signatureId(s), (bucket.get(signatureId(s)) ?? 0) + 1);
  };
  const hits = new Map<string, number>();
  const prevHits = new Map<string, number>();
  const beforeHits = new Map<string, number>();
  const ambiguousHits = new Map<string, number>();
  const prevReleases = new Set<string>();
  let decisive = 0;
  let byRelease = 0;
  let prev = 0;
  let before = 0;
  let ambiguous = 0;
  for (const line of lines) {
    const t = lineTime(line);
    if (t !== undefined && t < env.executedAt) continue;
    if (releaseMode && line.releaseId) {
      if (line.releaseId === window.afterReleaseId) {
        if (t !== undefined) {
          decisive++;
          byRelease++;
        }
        match(line, hits);
      } else {
        prev++;
        prevReleases.add(line.releaseId);
        match(line, prevHits);
      }
      continue;
    }
    if (t === undefined) match(line, hits);
    else if (t < boundary) {
      before++;
      match(line, beforeHits);
    } else if (t < boundary + resolution) {
      ambiguous++;
      match(line, ambiguousHits);
    } else {
      decisive++;
      match(line, hits);
    }
  }
  const seen = (m: Map<string, number>) => (m.size > 0 ? ` (seen there: ${fmt(m)})` : "");
  const where = releaseMode && byRelease > 0 ? `from the new release ${shortId(window.afterReleaseId!)}` : restartAt !== undefined ? `after the restart (${new Date(boundary).toISOString()})` : "since the change";
  const notes: string[] = [];
  if (releaseMode) notes.push(`${prev} lines from the previous release${prevReleases.size > 1 ? "s" : ""} ${[...prevReleases].map(shortId).join(", ") || shortId(window.beforeReleaseId!)} ignored${seen(prevHits)}`);
  if (restartAt !== undefined) {
    if (earlyUnreadable) notes.push("lines from before the restart could not be read");
    else if (!releaseMode || before > 0) notes.push(`${before} lines from before the restart ignored${seen(beforeHits)}`);
    if (ambiguous > 0) notes.push(`${ambiguous} lines in the restart second not attributed${seen(ambiguousHits)}`);
  }
  const note = notes.map((n) => `; ${n}`).join("");
  if (hits.size > 0) {
    checks.add("error_signature_absent", false, `checked ${ids.join(", ")} in ${decisive} log lines ${where}; seen ${where}: ${fmt(hits)}${note}`, opts);
  } else if (decisive === 0) {
    // An empty window proves nothing: absence over zero lines of the new process is not evidence of a fix.
    const none = releaseMode ? `no log lines from the new release ${shortId(window.afterReleaseId!)}${restartAt !== undefined ? ` or after the restart (${new Date(boundary).toISOString()})` : ""}` : `no log lines ${where}`;
    checks.record("error_signature_absent", "unknown", `${none}: the absence of ${ids.join(", ")} could not be shown${note}`, opts);
  } else {
    checks.add("error_signature_absent", true, `checked ${ids.join(", ")} in ${decisive} log lines ${where}${note}`, opts);
  }
}

/** The release in force now (re-read at check time, so a release that became current during the probes counts). */
export async function currentReleaseNow(env: VerifyEnv, app: string, fallback: string | undefined): Promise<string | undefined> {
  try {
    const page = await listReleases(env.liara, app, { page: 1, count: 5 });
    return page.currentRelease ?? page.releases[0]?._id ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * update_port read-back. Liara's app detail does not expose the configured port; the only port it reports is the
 * current release's. Equal => passed; anything else => unknown (never guessed, never "failed" on that basis).
 */
export async function verifyPortReadback(env: VerifyEnv, app: string, port: number, checks: Checks): Promise<void> {
  const opts = { signal: "config" as const, required: true };
  try {
    const page = await listReleases(env.liara, app, { page: 1, count: 5 });
    const current = page.releases.find((r) => page.currentRelease !== undefined && r._id === page.currentRelease) ?? page.releases[0];
    const reported = typeof current?.port === "number" ? current.port : undefined;
    if (reported === port) {
      checks.add("port_readback", true, `the current release reports port ${port}`, opts);
    } else {
      checks.record(
        "port_readback",
        "unknown",
        reported === undefined
          ? `Liara does not report the app's port, so port ${port} could not be read back`
          : `the current release reports port ${reported}; Liara does not expose the app's port setting separately, so port ${port} could not be read back`,
        opts,
      );
    }
  } catch (e) {
    const kind = (e as { kind?: unknown } | null)?.kind;
    checks.record("port_readback", "unknown", `the port could not be read back (${typeof kind === "string" ? kind : "error"})`, opts);
  }
}
