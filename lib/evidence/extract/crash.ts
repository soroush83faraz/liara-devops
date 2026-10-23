// crash: uncaught exception heads (+ first frame), non-zero exit codes, restart loops.
import { mergeOccurrence, occurrenceParams, type Occurrence } from "../lines";
import { draft, SIG } from "../observe";
import type { DraftObservation, EvidenceLine, ExtractContext } from "../types";
import { parseConnection } from "./connection";
import { parseMissingEnv } from "./missing-env";

// Exception head: "TypeError: x", "Uncaught Error [ERR_X]: y", "django.core.exceptions.ImproperlyConfigured: z",
// "KeyError: 'X'". The type must end in Error/Exception/a known Python name so prose like "Note: x" is ignored.
const HEAD =
  new RegExp(String.raw`(?:^|\s)(?:Uncaught\s+)?(?<type>[A-Za-z_][\w.]{0,80}(?:Error|Exception|KeyError|ImproperlyConfigured|SystemExit))(?:\s*\[[A-Z_]{2,40}\])?:\s*(?<msg>.{0,300})`);
const UNHANDLED = new RegExp(String.raw`\b(?<type>UnhandledPromiseRejection(?:Warning)?|unhandledRejection|uncaughtException)\b:?\s*(?<msg>.{0,300})`);
const GO_PANIC = new RegExp(String.raw`^panic:\s*(?<msg>.{1,300})`);
const PHP_FATAL = new RegExp(String.raw`PHP Fatal error:\s*(?:Uncaught\s+(?<type>[\w\\]+))?:?\s*(?<msg>.{0,300})`);
const NODE_FRAME = new RegExp(String.raw`^\s+at\s+(?<frame>.{1,300})$`);
const PY_FRAME = new RegExp(String.raw`^\s*File "(?<file>[^"]{1,300})", line (?<line>\d{1,7})`);
const EXIT_CODE = new RegExp(String.raw`\b(?:exit(?:ed)?|terminated|exiting)\s+(?:with\s+)?(?:exit\s+)?(?:code|status)\s*[:=]?\s*(?<code>\d{1,3})\b|\bexitCode[=:]\s*(?<code2>\d{1,3})\b`, "i");
const RESTART_EVENT = /back-?off restarting|restart(?:ed|ing)\b|CrashLoopBackOff|container (?:died|exited)/i;
// Lines from npm/build tooling start with these and are not runtime crashes.
const TOOLING = /^(?:npm (?:ERR!|error)|yarn|pnpm|#\d+ )/;

export interface CrashHead {
  type: string;
  message: string;
}

export function parseCrashHead(message: string): CrashHead | undefined {
  if (TOOLING.test(message)) return undefined;
  const m = UNHANDLED.exec(message) ?? HEAD.exec(message) ?? PHP_FATAL.exec(message);
  if (m?.groups) return { type: m.groups.type ?? "Fatal", message: (m.groups.msg ?? "").trim() };
  const p = GO_PANIC.exec(message);
  return p?.groups ? { type: "panic", message: p.groups.msg.trim() } : undefined;
}

/** First stack frame: Node/Java frames follow the head; Python frames precede it (innermost = last). */
export function firstFrame(lines: readonly EvidenceLine[], index: number): string | undefined {
  const after = lines.slice(index + 1, index + 12).map((l) => NODE_FRAME.exec(l.message)?.groups?.frame).filter(Boolean) as string[];
  if (after.length) return after.find((f) => !/node_modules|node:internal|\(internal\//.test(f)) ?? after[0];
  for (let i = index - 1; i >= Math.max(0, index - 40); i--) {
    const m = PY_FRAME.exec(lines[i].message);
    if (m?.groups) return `${m.groups.file}:${m.groups.line}`;
  }
  return undefined;
}

/** Which other extractor explains this crash head (it then supports that cause instead). */
export function explainedBy(message: string): string | undefined {
  if (parseMissingEnv(message).length) return "missing_env";
  if (parseConnection(message)) return "connection";
  if (/EADDRINUSE/.test(message)) return "port";
  if (/heap out of memory|MemoryError|OOMKilled/i.test(message)) return "oom";
  if (/Cannot find module|ModuleNotFoundError|No module named/.test(message)) return "dependency";
  return undefined;
}

/** Lifecycle events of the live releases only (containers of older releases describe the past). */
export function liveLifecycle(ctx: Pick<ExtractContext, "lifecycle" | "liveReleaseIds">) {
  const evs = ctx.lifecycle ?? [];
  if (!ctx.liveReleaseIds) return evs;
  const live = new Set(ctx.liveReleaseIds);
  return evs.filter((e) => !e.releaseId || live.has(e.releaseId));
}

/** A crash loop in lifecycle events: this many die->start cycles within the window. */
export const CRASH_LOOP_MIN_CYCLES = 3;
export const CRASH_LOOP_WINDOW_SEC = 60;

/** Densest run of die->start cycles (a `die` followed by a `start` before the next `die`) inside the window. */
export function lifecycleCrashLoop(ctx: ExtractContext): { cycles: number; firstMs: number; lastMs: number; tag?: string } | undefined {
  const evs = liveLifecycle(ctx);
  const cycles: Array<{ ms: number; tag?: string }> = [];
  evs.forEach((e, i) => {
    if (e.action !== "die") return;
    for (let j = i + 1; j < evs.length && evs[j].action !== "die"; j++) {
      if (evs[j].action === "start") {
        cycles.push({ ms: e.ts, tag: e.tag });
        return;
      }
    }
  });
  let best: { cycles: number; firstMs: number; lastMs: number; tag?: string } | undefined;
  for (let i = 0; i < cycles.length; i++) {
    let j = i;
    while (j + 1 < cycles.length && cycles[j + 1].ms - cycles[i].ms <= CRASH_LOOP_WINDOW_SEC * 1000) j++;
    const n = j - i + 1;
    if (n >= CRASH_LOOP_MIN_CYCLES && (!best || n > best.cycles)) best = { cycles: n, firstMs: cycles[i].ms, lastMs: cycles[j].ms, tag: cycles[j].tag };
  }
  return best;
}

export function extractCrash(ctx: ExtractContext): DraftObservation[] {
  const out: DraftObservation[] = [];
  const heads = new Map<string, { head: CrashHead; frame?: string; occ: Occurrence }>();
  for (const g of ctx.logGroups) {
    const head = parseCrashHead(g.message);
    if (!head) continue;
    const id = `${head.type}|${g.pattern}`;
    const prev = heads.get(id);
    heads.set(id, { head, frame: prev?.frame ?? firstFrame(ctx.logs, g.firstIndex), occ: mergeOccurrence(prev?.occ, g) });
  }
  for (const { head, frame, occ } of heads.values()) {
    const by = explainedBy(occ.sample);
    out.push(
      draft("crash", "liara:logs", "evidence.crash.exception", "error", frame ? `${occ.sample}\n    at ${frame}` : occ.sample, {
        errorType: head.type,
        errorMessage: head.message.slice(0, 200),
        frame,
        explainedBy: by,
        ...occurrenceParams(occ),
        [SIG]: Boolean(frame) || occ.count >= 2,
      }, occ.firstTs),
    );
  }

  const exits = new Map<string, Occurrence>();
  for (const g of [...ctx.logGroups, ...ctx.eventGroups]) {
    const m = EXIT_CODE.exec(g.message);
    const code = m?.groups?.code ?? m?.groups?.code2;
    if (code && code !== "0") exits.set(code, mergeOccurrence(exits.get(code), g));
  }
  for (const [code, occ] of exits) {
    out.push(
      draft("crash", "liara:logs", "evidence.crash.exit_code", "error", occ.sample, {
        exitCode: Number(code),
        ...occurrenceParams(occ),
        [SIG]: false,
      }, occ.firstTs),
    );
  }

  let restarts = 0;
  let restartOcc: Occurrence | undefined;
  for (const g of ctx.eventGroups) {
    if (!RESTART_EVENT.test(g.message)) continue;
    restarts += g.count;
    restartOcc = mergeOccurrence(restartOcc, g);
  }
  const loopApplet = ctx.applets.find((a) => /CrashLoopBackOff/i.test(`${a.state ?? ""} ${a.reason ?? ""}`));
  const life = lifecycleCrashLoop(ctx);
  if (restarts >= 3 || loopApplet) {
    out.push(
      draft("crash", restartOcc ? "liara:events" : "liara:applets", "evidence.crash.crashloop", "error",
        restartOcc?.sample ?? `${loopApplet?.name ?? "applet"}: ${loopApplet?.reason ?? loopApplet?.state ?? ""}`,
        { restarts, appletReason: loopApplet?.reason, ...(restartOcc ? occurrenceParams(restartOcc) : {}), [SIG]: true },
        restartOcc?.firstTs ?? loopApplet?.timestamp),
    );
  } else if (life) {
    out.push(
      draft("crash", "liara:events", "evidence.crash.crashloop", "error",
        `container die+start x${life.cycles} within ${CRASH_LOOP_WINDOW_SEC}s (${new Date(life.firstMs).toISOString()} .. ${new Date(life.lastMs).toISOString()})`,
        { restarts: life.cycles, windowSec: CRASH_LOOP_WINDOW_SEC, count: life.cycles, firstSeen: new Date(life.firstMs).toISOString(), lastSeen: new Date(life.lastMs).toISOString(), releaseTag: life.tag, [SIG]: true },
        new Date(life.firstMs).toISOString()),
    );
  }
  return out;
}

export { RESTART_EVENT };
