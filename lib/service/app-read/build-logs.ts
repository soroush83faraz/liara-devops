// Server-only. Browser build-log views (one-shot `/api/releases/{id}/build-logs` and SSE `/stream`). A release
// does not carry its app name, so the UI passes `?app=<name>`; with it the app's env values are loaded as known
// secrets (logRedactorFor: cached 60 s per account, never returned) and scrubbed in every transformed form.
// Without `app` (or with env values unreadable) only the pattern rules apply.
import { getBuildLogPages, type LiaraClient } from "../../liara";
import { createRedactor, type Redactor } from "../../security/redact";
import { splitBuildLine } from "./build-log-text";
import { logRedactorFor, type RedactorScope } from "./known-secrets";
import { toReleaseDto } from "./mappers";
import { isValidAppName } from "./params";
import { maskLines, maskSecrets } from "./safe-text";

export const BUILD_LOG_MAX_LINES = 3000;
/** Liara serves ~20 lines per call; 100 pages cover the 2000 entries kept (the read stops earlier on the last page). */
export const BUILD_LOG_MAX_PAGES = 100;
export const BUILD_LOG_MAX_ENTRIES = 2000;

const PATTERNS_ONLY = createRedactor();

/** `?app=`: `{ app: undefined }` when absent, `{ invalid: true }` when present but not a safe app name. */
export function appParam(sp: URLSearchParams): { app?: string; invalid?: true } {
  const v = sp.get("app");
  if (v === null || v === "") return {};
  return isValidAppName(v) ? { app: v } : { invalid: true };
}

/** Known-secret redactor for the given app, or patterns only when no app was given. Never throws. */
export async function buildLogRedactor(liara: LiaraClient, scope: RedactorScope, app: string | undefined): Promise<Redactor> {
  if (!app) return PATTERNS_ONLY;
  return logRedactorFor(liara, scope, app);
}

/**
 * Body of the one-shot build-logs response: all pages (bounded), ANSI stripped, multi-line entries split, last 3000
 * lines masked as a batch, + the release summary. `partial` = a cap or a failed later page cut the read short.
 */
export async function readBuildLogs(liara: LiaraClient, releaseId: string, redactor: Redactor, signal?: AbortSignal) {
  const res = await getBuildLogPages(liara, releaseId, { maxPages: BUILD_LOG_MAX_PAGES, maxLines: BUILD_LOG_MAX_ENTRIES, signal });
  const all = res.buildOutput.flatMap((l) =>
    splitBuildLine(l.line).map((text) => ({ stream: l.stream === "STDERR" ? ("STDERR" as const) : ("STDOUT" as const), text, createdAt: l.createdAt })),
  );
  const tail = all.slice(-BUILD_LOG_MAX_LINES);
  const masked = maskLines(tail.map((l) => l.text), redactor);
  const lines = tail.map((l, i) => ({
    stream: l.stream,
    line: masked[i],
    ...(l.createdAt ? { createdAt: l.createdAt } : {}),
  }));
  const release = res.release ? toReleaseDto(res.release) : undefined;
  return {
    release: release?.failReason ? { ...release, failReason: maskSecrets(release.failReason, redactor) } : release,
    lines,
    truncated: all.length > BUILD_LOG_MAX_LINES,
    maxLines: BUILD_LOG_MAX_LINES,
    partial: res.partial,
  };
}
