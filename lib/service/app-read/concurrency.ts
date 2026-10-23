/** Per-key concurrency cap (e.g. 3 simultaneous log tails per account). In-memory, per server process. */
export interface CapTracker {
  /** Returns an idempotent release function, or null when the cap is reached. */
  acquire(key: string): (() => void) | null;
  count(key: string): number;
}

export function createCapTracker(max: number): CapTracker {
  const counts = new Map<string, number>();
  return {
    acquire(key) {
      const n = counts.get(key) ?? 0;
      if (n >= max) return null;
      counts.set(key, n + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const cur = counts.get(key) ?? 0;
        if (cur <= 1) counts.delete(key);
        else counts.set(key, cur - 1);
      };
    },
    count: (key) => counts.get(key) ?? 0,
  };
}

const KEY = Symbol.for("hamyar.logTailCap");
export const MAX_TAILS_PER_ACCOUNT = 3;

/** Process-wide tracker that survives HMR in development. */
export function logTailCap(): CapTracker {
  const g = globalThis as unknown as Record<symbol, CapTracker | undefined>;
  return (g[KEY] ??= createCapTracker(MAX_TAILS_PER_ACCOUNT));
}
