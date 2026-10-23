// Per-account cap on concurrently running agent streams (in-process; one server process owns the app).
const KEY = Symbol.for("hamyar.agent.running.v1");

function table(): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  let t = g[KEY];
  if (!t) {
    t = new Map();
    g[KEY] = t;
  }
  return t;
}

export const MAX_CONCURRENT_RUNS = 2;

/** Returns a release function, or null when the account already has `max` runs in flight. */
export function acquireRun(accountId: string, max = MAX_CONCURRENT_RUNS): (() => void) | null {
  const t = table();
  const n = t.get(accountId) ?? 0;
  if (n >= max) return null;
  t.set(accountId, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = (t.get(accountId) ?? 1) - 1;
    if (cur <= 0) t.delete(accountId);
    else t.set(accountId, cur);
  };
}

export function runningCount(accountId: string): number {
  return table().get(accountId) ?? 0;
}
