// Process-wide singletons. Next.js bundles each route separately, so plain module state would give the
// execute route and the events route different copies; globalThis + Symbol.for gives one per process.
export function processSingleton<T>(name: string, init: () => T): T {
  const key = Symbol.for(`hamyar.actions.${name}.v1`);
  const g = globalThis as unknown as Record<symbol, T | undefined>;
  let value = g[key];
  if (value === undefined) {
    value = init();
    g[key] = value;
  }
  return value;
}

/**
 * In-flight guard per (account, team, target): one mutation at a time per resource, so two operations can
 * never interleave a read-merge-write of the same env list. Returns a release function, or undefined when busy.
 */
export function tryLockTarget(key: string): (() => void) | undefined {
  const locks = processSingleton("target-locks", () => new Set<string>());
  if (locks.has(key)) return undefined;
  locks.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks.delete(key);
  };
}

/** Keyed by the resource OWNER (the team when present), so two members of one team are serialized too. */
export function targetLockKey(accountId: string, teamId: string, target: { kind: string; name: string }): string {
  const owner = teamId ? `team:${teamId}` : `acct:${accountId}`;
  return `${owner}\u0000${target.kind}:${target.name}`;
}

/** Background executions running in this process (stuck-proposal detection). */
export function runningJobs(): Map<string, number> {
  return processSingleton("running-jobs", () => new Map<string, number>());
}

export const jobKey = (accountId: string, proposalId: string) => `${accountId}\u0000${proposalId}`;
