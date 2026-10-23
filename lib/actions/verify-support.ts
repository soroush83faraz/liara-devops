// Small building blocks for verification: an injectable clock, bounded polling and a check collector.
import type { LiaraClient } from "@/lib/liara";
import { sleep as abortableSleep } from "@/lib/liara/util";
import type { VerificationCheck, VerificationCheckStatus } from "@/lib/contracts/proposal";
import type { ProbeResult } from "@/lib/canvas/types";

export type ProbeFn = (liara: LiaraClient, app: string) => Promise<ProbeResult>;

export interface Clock {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const systemClock: Clock = { now: () => Date.now(), sleep: abortableSleep };

export interface PollResult<T> {
  last?: T;
  ok: boolean;
  /** Successful reads; 0 means the state could never be read. */
  reads: number;
  lastErrorKind?: string;
  /** When `done` first held (epoch ms). */
  doneAt?: number;
}

/**
 * Polls `read` every `pollMs` until `done` or `deadline`. Read errors are tolerated and counted; a not-found
 * read stops early unless `stopOnNotFound` is false (a just-created resource may appear late).
 */
export async function pollUntil<T>(
  clock: Clock,
  deadline: number,
  pollMs: number,
  signal: AbortSignal | undefined,
  read: () => Promise<T>,
  done: (t: T) => boolean,
  opts: { stopOnNotFound?: boolean; /** Bounded backoff: each gap grows by `factor`, capped at `maxMs`. */ backoff?: { factor: number; maxMs: number } } = {},
): Promise<PollResult<T>> {
  const stopOnNotFound = opts.stopOnNotFound ?? true;
  let last: T | undefined;
  let reads = 0;
  let lastErrorKind: string | undefined;
  let gap = pollMs;
  for (;;) {
    if (signal?.aborted) return { last, ok: false, reads, lastErrorKind: "aborted" };
    try {
      last = await read();
      reads++;
      if (done(last)) return { last, ok: true, reads, doneAt: clock.now() };
    } catch (e) {
      const kind = (e as { kind?: unknown } | null)?.kind;
      lastErrorKind = typeof kind === "string" && /^[a-z_]{1,32}$/.test(kind) ? kind : "error";
      if (kind === "not_found" && stopOnNotFound) return { last, ok: false, reads, lastErrorKind };
    }
    // With backoff the last gap is clamped to the deadline so a long gap never skips the final read.
    const wait = opts.backoff ? Math.min(gap, deadline - clock.now()) : gap;
    if (wait <= 0 || clock.now() + wait > deadline) return { last, ok: false, reads, lastErrorKind };
    await clock.sleep(wait, signal);
    if (opts.backoff) gap = Math.min(opts.backoff.maxMs, Math.max(pollMs, Math.round(gap * opts.backoff.factor)));
  }
}

/** Independent sources of evidence; two checks from the same source count as one positive signal. */
export type CheckSignal = "state" | "probe" | "logs" | "config";

export interface CheckEntry extends VerificationCheck {
  status: VerificationCheckStatus;
  /** A failed fatal check makes the outcome `failed` (the action definitively did not take effect). */
  fatal?: boolean;
  /** Required for this action type: unknown/skipped => the outcome cannot be `verified`. */
  required?: boolean;
  /** Evidence source; a passed check contributes one positive signal of this kind. */
  signal?: CheckSignal;
}

export interface CheckOptions {
  fatal?: boolean;
  required?: boolean;
  signal?: CheckSignal;
}

export class Checks {
  readonly list: CheckEntry[] = [];
  /** Progress hook (verifyAction streams checks as they complete). */
  onAdd?: (entry: CheckEntry) => void;

  /** passed/failed check. `opts === true` is the legacy `fatal` flag. */
  add(name: string, passed: boolean, detail: string, opts: boolean | CheckOptions = {}): CheckEntry {
    return this.record(name, passed ? "passed" : "failed", detail, opts);
  }

  record(name: string, status: VerificationCheckStatus, detail: string, opts: boolean | CheckOptions = {}): CheckEntry {
    const o: CheckOptions = typeof opts === "boolean" ? { fatal: opts } : opts;
    const entry: CheckEntry = {
      name,
      passed: status === "passed",
      status,
      detail: detail.slice(0, 500),
      ...(o.fatal ? { fatal: true } : {}),
      ...(o.required ? { required: true } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
    };
    this.list.push(entry);
    this.onAdd?.(entry);
    return entry;
  }

  get anyFatal(): boolean {
    return this.list.some((c) => c.status === "failed" && c.fatal);
  }
}
