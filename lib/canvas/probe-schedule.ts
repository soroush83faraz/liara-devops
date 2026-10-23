// Pure scheduling for the staggered probe loop: which services are due, honouring the concurrency cap.
export const PROBE_INTERVAL_MS = 30_000;
export const PROBE_CONCURRENCY = 3;
export const PROBE_BACKOFF_MS = 60_000;

export interface ProbeSchedule {
  /** Earliest time (ms epoch) each service may be probed again; absent = probe immediately. */
  nextAt: ReadonlyMap<string, number>;
  inFlight: ReadonlySet<string>;
}

/** Due services (most overdue first), limited by the free concurrency slots. */
export function dueServices(ids: readonly string[], schedule: ProbeSchedule, now: number, concurrency = PROBE_CONCURRENCY): string[] {
  const slots = Math.max(0, concurrency - schedule.inFlight.size);
  if (slots === 0) return [];
  return ids
    .filter((id) => !schedule.inFlight.has(id) && (schedule.nextAt.get(id) ?? 0) <= now)
    .sort((a, b) => (schedule.nextAt.get(a) ?? 0) - (schedule.nextAt.get(b) ?? 0))
    .slice(0, slots);
}
