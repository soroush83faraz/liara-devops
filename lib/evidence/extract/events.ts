// events: platform events that matter for correlation (env changes, restarts, scale changes).
import type { AppLifecycleEvent } from "@/lib/liara/events";
import { mergeOccurrence, occurrenceParams, type Occurrence } from "../lines";
import { draft, SIG } from "../observe";
import type { DraftObservation, ExtractContext, ReleaseFacts } from "../types";
import { RESTART_EVENT } from "./crash";

// Event text format is unverified [VAL]; these cover CLI/console phrasings seen in docs.
export const ENV_CHANGE_EVENT = /\b(?:env(?:ironment)?[ _-]?(?:variables?|vars?|envs?)?\s*(?:were |was |has been )?(?:updated|changed|set|modified|removed|deleted)|update[_ -]?envs?|UpdateEnvs?|EnvsUpdated|envs? update)\b/i;
export const SCALE_EVENT = /\b(?:scaled? (?:to|down|up)|ScalingReplicaSet|stopped by user|started by user)\b/i;

const STOP_ACTIONS = new Set(["die", "kill", "stop"]);
const iso = (ms: number) => new Date(ms).toISOString();

/** The release a lifecycle event belongs to (by id), else the newest release. */
function releaseOf(ctx: ExtractContext, e: AppLifecycleEvent): ReleaseFacts | undefined {
  return (e.releaseId ? ctx.releases.find((r) => r.id === e.releaseId) : undefined) ?? ctx.releases[0];
}

/** When the release became live as far as the data says: finishedAt, else createdAt. */
function releaseMs(r: ReleaseFacts | undefined): number | undefined {
  const ms = Date.parse(r?.finishedAt ?? r?.createdAt ?? "");
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Container lifecycle events (live shape 2026-10-23): creates/starts/restarts as info with counts and first/last
 * timestamps, related to the release time; die/kill/stop as warn (info when a container of another release was
 * created or started afterwards). Observed facts only, no causes.
 */
export function extractLifecycle(ctx: ExtractContext): DraftObservation[] {
  const evs = ctx.lifecycle ?? [];
  if (!evs.length) return [];
  const out: DraftObservation[] = [];

  const up = evs.filter((e) => e.action === "create" || e.action === "start" || e.action === "restart");
  if (up.length) {
    const count = (a: string) => up.filter((e) => e.action === a).length;
    const first = up[0];
    const last = up[up.length - 1];
    const rel = releaseOf(ctx, first);
    const relMs = releaseMs(rel);
    const tag = last.tag ?? rel?.tag;
    out.push(draft("event", "liara:events", "evidence.event.lifecycle", "info",
      `container events: ${count("create")} create, ${count("start")} start, ${count("restart")} restart (${iso(first.ts)} .. ${iso(last.ts)})`,
      {
        creates: count("create"),
        starts: count("start"),
        restarts: count("restart"),
        count: up.length,
        firstSeen: iso(first.ts),
        lastSeen: iso(last.ts),
        releaseId: last.releaseId ?? rel?.id,
        releaseTag: tag,
        sinceReleaseSec: relMs === undefined ? undefined : Math.round((first.ts - relMs) / 1000),
        [SIG]: false,
      }, iso(first.ts)));
  }

  const stops = evs.filter((e) => STOP_ACTIONS.has(e.action));
  if (stops.length) {
    const superseded = stops.filter((s) => evs.some((e) => e.ts > s.ts && (e.action === "create" || e.action === "start") && s.releaseId && e.releaseId && e.releaseId !== s.releaseId));
    const actions = [...new Set(stops.map((e) => e.action))].join(",");
    const first = stops[0];
    const last = stops[stops.length - 1];
    const relMs = releaseMs(releaseOf(ctx, first));
    out.push(draft("event", "liara:events", "evidence.event.container_stop", superseded.length === stops.length ? "info" : "warn",
      `container ${actions} x${stops.length} (${iso(first.ts)} .. ${iso(last.ts)})`,
      {
        count: stops.length,
        actions,
        supersededByOtherRelease: superseded.length,
        firstSeen: iso(first.ts),
        lastSeen: iso(last.ts),
        releaseId: last.releaseId,
        releaseTag: last.tag,
        sinceReleaseSec: relMs === undefined ? undefined : Math.round((first.ts - relMs) / 1000),
        [SIG]: false,
      }, iso(first.ts)));
  }
  return out;
}

export function extractEvents(ctx: ExtractContext): DraftObservation[] {
  const out: DraftObservation[] = extractLifecycle(ctx);
  const kinds: Array<[string, RegExp]> = [
    ["env_change", ENV_CHANGE_EVENT],
    ["scale", SCALE_EVENT],
    ["restart", RESTART_EVENT],
  ];
  for (const [kind, re] of kinds) {
    let occ: Occurrence | undefined;
    for (const g of ctx.eventGroups) if (re.test(g.message)) occ = mergeOccurrence(occ, g);
    if (!occ) continue;
    out.push(draft("event", "liara:events", `evidence.event.${kind}`, kind === "restart" ? "warn" : "info", occ.sample,
      { event: kind, ...occurrenceParams(occ), [SIG]: false }, occ.firstTs));
  }
  return out;
}
