// release-state: newest release failed/unhealthy/timed out/canceled; current vs previous release.
import { draft, SIG } from "../observe";
import type { DraftObservation, ExtractContext, ReleaseFacts } from "../types";

const BAD = /^(?:FAILED|UNHEALTHY|TIMEDOUT)$/i;
const CANCELED = /^CANCEL+ED$/i;
const IN_PROGRESS = /^(?:BUILDING|DEPLOYING|QUEUED|PENDING|PULLING|PUSHING)$/i;
const READY = /^READY$/i;

export const isReady = (r: ReleaseFacts | undefined) => READY.test(r?.state ?? "");

/** The release currently serving traffic: the API's `currentRelease`, else the newest READY one. */
export function currentRelease(ctx: Pick<ExtractContext, "releases" | "currentReleaseId">): ReleaseFacts | undefined {
  return (ctx.currentReleaseId ? ctx.releases.find((r) => r.id === ctx.currentReleaseId) : undefined) ?? ctx.releases.find(isReady);
}

/** The newest READY release older than the current one (target of a redeploy-previous). */
export function previousReady(ctx: Pick<ExtractContext, "releases" | "currentReleaseId">): ReleaseFacts | undefined {
  const cur = currentRelease(ctx);
  const idx = cur ? ctx.releases.indexOf(cur) : -1;
  return ctx.releases.slice(idx + 1).find(isReady);
}

export function extractReleaseState(ctx: ExtractContext): DraftObservation[] {
  const newest = ctx.releases[0];
  if (!newest) return [];
  const out: DraftObservation[] = [];
  const cur = currentRelease(ctx);
  const prev = previousReady(ctx);
  const state = (newest.state ?? "UNKNOWN").toUpperCase();
  const common = {
    state,
    releaseTag: newest.tag,
    releaseId: newest.id,
    createdAt: newest.createdAt,
    finishedAt: newest.finishedAt,
    failReason: newest.failReason,
    isCurrent: cur ? cur === newest : undefined,
    currentTag: cur?.tag,
    currentReleaseId: cur?.id,
    previousReadyTag: prev?.tag,
    previousReadyId: prev?.id,
  };

  if (BAD.test(state)) {
    out.push(draft("release_state", "liara:releases", `evidence.release.${state.toLowerCase()}`, "error",
      `release ${newest.tag ?? newest.id ?? "?"} ${state}${newest.failReason ? `: ${newest.failReason}` : ""}`,
      { ...common, [SIG]: true }, newest.finishedAt ?? newest.createdAt));
  } else if (CANCELED.test(state)) {
    out.push(draft("release_state", "liara:releases", "evidence.release.canceled", "warn",
      `release ${newest.tag ?? newest.id ?? "?"} CANCELED`, { ...common, [SIG]: false }, newest.finishedAt ?? newest.createdAt));
  } else if (IN_PROGRESS.test(state)) {
    out.push(draft("release_state", "liara:releases", "evidence.release.in_progress", "info",
      `release ${newest.tag ?? newest.id ?? "?"} ${state}`, { ...common, [SIG]: false }, newest.createdAt));
  }

  // The newest release did not go live and an older one keeps serving (Liara keeps the previous READY release).
  if (cur && cur !== newest && (BAD.test(state) || CANCELED.test(state))) {
    out.push(draft("release_state", "liara:releases", "evidence.release.newest_not_serving", "warn",
      `newest release ${newest.tag ?? newest.id ?? "?"} ${state}; still serving ${cur.tag ?? cur.id ?? "?"}`,
      {
        newestTag: newest.tag,
        newestId: newest.id,
        newestState: state,
        releaseTag: newest.tag,
        releaseId: newest.id,
        currentTag: cur.tag,
        currentReleaseId: cur.id,
        [SIG]: false,
      }, newest.finishedAt ?? newest.createdAt));
  }

  // Always describe what is serving now; the hypothesis rules use it for "after release" and redeploy hints.
  if (cur) {
    out.push(draft("release_state", "liara:releases", "evidence.release.current", "info",
      `current release ${cur.tag ?? cur.id ?? "?"}${prev ? ` (previous ready ${prev.tag ?? prev.id})` : ""}`,
      {
        state: (cur.state ?? "").toUpperCase(),
        releaseTag: cur.tag,
        releaseId: cur.id,
        createdAt: cur.createdAt,
        finishedAt: cur.finishedAt,
        previousReadyTag: prev?.tag,
        previousReadyId: prev?.id,
        newestIsCurrent: cur === newest,
        [SIG]: false,
      }, cur.finishedAt ?? cur.createdAt));
  }
  return out;
}
