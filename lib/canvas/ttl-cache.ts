// Tiny per-key TTL cache with in-flight de-duplication. Protects Liara's (unknown) rate limits from
// several tabs / quick refreshes. State lives on globalThis so dev HMR does not drop it.

interface Entry<T> {
  at: number;
  value?: T;
  inflight?: Promise<T>;
}

export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createTtlCache<T>(ttlMs: number, maxEntries = 200, now: () => number = Date.now): TtlCache<T> {
  const map = new Map<string, Entry<T>>();
  return {
    async get(key, load) {
      const hit = map.get(key);
      if (hit?.value !== undefined && now() - hit.at < ttlMs) return hit.value;
      if (hit?.inflight) return hit.inflight;
      const inflight = load().then(
        (value) => {
          map.set(key, { at: now(), value });
          return value;
        },
        (error) => {
          map.delete(key); // never cache failures
          throw error;
        },
      );
      map.set(key, { at: hit?.at ?? 0, value: hit?.value, inflight });
      if (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      return inflight;
    },
    clear: () => map.clear(),
  };
}

export function globalCache<T>(name: string, ttlMs: number): TtlCache<T> {
  const g = globalThis as unknown as Record<symbol, TtlCache<T> | undefined>;
  const sym = Symbol.for(`hamyar.canvas.cache.${name}`);
  return (g[sym] ??= createTtlCache<T>(ttlMs));
}
