// oom: kill/out-of-memory signals in events, applet reasons and logs, weighed against memory vs plan RAM.
import { combineOccurrences, mergeOccurrence, occurrenceParams, singleOccurrence, type Occurrence } from "../lines";
import { draft, SIG } from "../observe";
import type { DraftObservation, ExtractContext } from "../types";
import { liveLifecycle } from "./crash";
import { MEM_NEAR_LIMIT_PCT, memPct } from "./metric";

const CONTAINER_OOM = /OOMKilled|OOM[- ]?kill(?:ed|er)?|Out of memory: Kill(?:ed)? process|memory cgroup out of memory/i;
const HEAP_OOM = /JavaScript heap out of memory|Reached heap limit|\bMemoryError\b|Allowed memory size of \d+ bytes exhausted/i;
// Ambiguous: a plain SIGKILL also happens on stop/redeploy. Only counts with memory near the limit.
const WEAK_KILL = /\bKilled\b|SIGKILL|exit(?:ed)? (?:with )?code 137|signal: killed/i;

export type OomScope = "container" | "heap" | "kill";

export function classifyOom(text: string): OomScope | undefined {
  if (CONTAINER_OOM.test(text)) return "container";
  if (HEAP_OOM.test(text)) return "heap";
  if (WEAK_KILL.test(text)) return "kill";
  return undefined;
}

type OomSource = "liara:events" | "liara:applets" | "liara:logs";

export function extractOom(ctx: ExtractContext): DraftObservation[] {
  const mem = memPct(ctx.metrics?.memBytes, ctx.plan);
  const near = mem !== undefined && mem >= MEM_NEAR_LIMIT_PCT;
  const found = new Map<string, { scope: OomScope; source: OomSource; occ: Occurrence }>();
  const add = (scope: OomScope, source: OomSource, occ: Occurrence) => {
    const id = `${scope}|${source}`;
    found.set(id, { scope, source, occ: combineOccurrences(found.get(id)?.occ, occ) });
  };

  for (const g of ctx.eventGroups) {
    const scope = classifyOom(g.message);
    if (scope) add(scope, "liara:events", mergeOccurrence(undefined, g));
  }
  // Container lifecycle `oom` actions (live events shape): the platform itself reports the OOM kill.
  const lifeOoms = liveLifecycle(ctx).filter((e) => e.action === "oom");
  if (lifeOoms.length) {
    const first = lifeOoms[0];
    const last = lifeOoms[lifeOoms.length - 1];
    add("container", "liara:events", {
      count: lifeOoms.length,
      firstTs: new Date(first.ts).toISOString(),
      lastTs: new Date(last.ts).toISOString(),
      firstMs: first.ts,
      lastMs: last.ts,
      sample: `container oom x${lifeOoms.length} (${new Date(first.ts).toISOString()})`,
    });
  }
  for (const a of ctx.applets) {
    const text = `${a.state ?? ""} ${a.reason ?? ""}`.trim();
    const scope = classifyOom(text);
    if (scope) add(scope, "liara:applets", singleOccurrence(`${a.name ?? "applet"}: ${text}`, a.timestamp));
  }
  for (const g of ctx.logGroups) {
    const scope = classifyOom(g.message);
    if (scope && scope !== "kill") add(scope, "liara:logs", mergeOccurrence(undefined, g));
  }

  return [...found.values()].map(({ scope, source, occ }) => {
    const strong = scope !== "kill" || near;
    return draft("oom", source, `evidence.oom.${scope}`, strong ? "error" : "warn", occ.sample, {
      scope,
      kills: occ.count,
      memPct: mem,
      nearLimit: near,
      ...occurrenceParams(occ),
      [SIG]: strong,
    }, occ.firstTs);
  });
}
