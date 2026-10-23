/** Mirrors `TERMINAL_RELEASE_STATES` of lib/liara (asserted equal in a unit test); kept local so client bundles stay light. */
export const TERMINAL_STATES = ["READY", "FAILED", "CANCELED", "TIMEDOUT", "UNHEALTHY"] as const;

/** States that mean a build/deploy is still progressing [CLI]; anything else is rendered statically. */
const IN_PROGRESS = ["DEPLOYING", "BUILDING", "QUEUED", "PENDING", "STARTING", "BUILD"] as const;

export const isInProgressState = (state?: string): boolean =>
  (IN_PROGRESS as readonly string[]).includes((state ?? "").toUpperCase());

export const isTerminalState = (state?: string): boolean =>
  (TERMINAL_STATES as readonly string[]).includes((state ?? "").toUpperCase());

export type ReleaseTone = "ok" | "warn" | "danger" | "info" | "neutral";

export function releaseTone(state?: string): ReleaseTone {
  switch ((state ?? "").toUpperCase()) {
    case "READY":
      return "ok";
    case "FAILED":
    case "UNHEALTHY":
    case "TIMEDOUT":
      return "danger";
    case "CANCELED":
      return "neutral";
    default:
      return isInProgressState(state) ? "info" : "neutral";
  }
}

/** Duration in ms between two ISO timestamps; `now` is used for unfinished releases. Undefined when not computable. */
export function releaseDurationMs(createdAt?: string | null, finishedAt?: string | null, now: number = Date.now()): number | undefined {
  if (!createdAt) return undefined;
  const start = Date.parse(createdAt);
  if (Number.isNaN(start)) return undefined;
  const end = finishedAt ? Date.parse(finishedAt) : now;
  if (Number.isNaN(end)) return undefined;
  const d = end - start;
  return d >= 0 ? d : undefined;
}

/** Tone for a pod/applet state string (Kubernetes-like names are an assumption [VAL]); unknown => neutral. */
export function appletTone(state?: string): ReleaseTone {
  const s = (state ?? "").toLowerCase();
  if (!s) return "neutral";
  if (/(crash|error|fail|oom|backoff|evict|unhealthy|imagepull)/.test(s)) return "danger";
  if (/(running|ready|healthy)/.test(s)) return "ok";
  if (/(pending|creating|starting|init|deploy|build|terminating)/.test(s)) return "info";
  return "neutral";
}
