import {
  getBuildLogs,
  getRelease,
  isLiaraError,
  watchRelease,
  type LiaraClient,
  type WatchEvent,
} from "../../liara";
import type { Redactor } from "../../security/redact";
import { stripAnsi } from "../../evidence/lines";
import { maskSecrets } from "./safe-text";
import { isTerminalState } from "./release-utils";
import type { ReleaseStreamEvent } from "./types";

export interface ReleaseStreamOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Poll interval for the tail phase after a STDERR line (default 1500). */
  followIntervalMs?: number;
  /** Known-secret redactor of the app (see build-logs.ts); patterns only when omitted. */
  redactor?: Redactor;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

export function maskWatchEvent(ev: WatchEvent, redactor?: Redactor): ReleaseStreamEvent {
  switch (ev.kind) {
    case "log":
      return { kind: "log", stream: ev.stream, line: maskSecrets(stripAnsi(ev.line), redactor), ...(ev.createdAt ? { createdAt: ev.createdAt } : {}) };
    case "done":
      return {
        kind: "done",
        state: ev.state,
        ok: ev.ok,
        ...(ev.failReason ? { failReason: maskSecrets(ev.failReason, redactor) } : {}),
        ...(ev.reason ? { reason: ev.reason } : {}),
      };
    default:
      return ev;
  }
}

/**
 * `watchRelease` ends the watch as FAILED on the first STDERR build line (the CLI does the same), but many
 * builders print harmless warnings to stderr. When that happens we verify the real release state and, if the
 * build is still running, keep following the logs until the release reaches a terminal state.
 */
export async function* streamRelease(
  client: LiaraClient,
  releaseId: string,
  opts: ReleaseStreamOptions = {},
): AsyncGenerator<ReleaseStreamEvent> {
  const { signal, timeoutMs = 30 * 60_000, followIntervalMs = 1500, redactor } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastCreatedAt: string | undefined;
  const seen = new Set<string>();

  for await (const ev of watchRelease(client, releaseId, { signal, timeoutMs })) {
    if (ev.kind === "log") {
      if (ev.createdAt) lastCreatedAt = ev.createdAt;
      seen.add(`${ev.createdAt ?? ""}|${ev.line}`);
    }
    if (!(ev.kind === "done" && ev.reason === "build_stderr")) {
      yield maskWatchEvent(ev, redactor);
      continue;
    }
    // STDERR heuristic fired: check the authoritative state before reporting failure.
    let state: string | undefined;
    let failReason = ev.failReason;
    try {
      const r = await getRelease(client, releaseId, signal);
      state = r.state;
      failReason = r.failReason ?? failReason;
    } catch (e) {
      if (isLiaraError(e) && ["auth", "forbidden", "not_found"].includes(e.kind)) throw e;
    }
    if (state && isTerminalState(state)) {
      yield maskWatchEvent({ kind: "done", state, ok: state === "READY", ...(failReason ? { failReason } : {}) }, redactor);
      return;
    }
    // Still building: tail by polling build logs until terminal (or deadline / abort).
    yield { kind: "state", state: state ?? "DEPLOYING" };
    while (!signal?.aborted && Date.now() < deadline) {
      await sleep(followIntervalMs, signal);
      if (signal?.aborted) return;
      try {
        const r = await getBuildLogs(client, releaseId, { since: lastCreatedAt, signal });
        let fresh = 0;
        for (const l of r.buildOutput) {
          const key = `${l.createdAt ?? ""}|${l.line}`;
          if (seen.has(key)) continue;
          seen.add(key);
          fresh++;
          if (l.createdAt) lastCreatedAt = l.createdAt;
          yield maskWatchEvent({ kind: "log", stream: l.stream === "STDERR" ? "STDERR" : "STDOUT", line: l.line, createdAt: l.createdAt }, redactor);
        }
        const s = r.release?.state;
        // Pages hold ~20 lines: a terminal state only ends the stream once a poll brings nothing new.
        if (s && isTerminalState(s) && fresh === 0) {
          yield maskWatchEvent({ kind: "done", state: s, ok: s === "READY", ...(r.release?.failReason ? { failReason: r.release.failReason } : {}) }, redactor);
          return;
        }
      } catch (e) {
        if (isLiaraError(e) && ["auth", "forbidden", "not_found"].includes(e.kind)) throw e;
      }
    }
    if (!signal?.aborted) yield { kind: "done", state: "TIMEDOUT", ok: false, reason: "watch_timeout" };
    return;
  }
}
