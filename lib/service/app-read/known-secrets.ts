// Server-only. Known-secret scrubbing for log text shown in the BROWSER: an app may print its own env values in
// a transformed form (base64, hex, upper-cased, split over two lines) that pattern rules cannot recognise. The
// app's env values are read server-side (getEnvs), turned into a prepared Redactor and cached briefly per
// account + team + app so a log tail does not refetch them on every line.
// The values themselves are never returned, logged or persisted: only the redactor holds (variants of) them, in
// process memory, for at most TTL_MS; the table is bounded.
import { getEnvs, type LiaraClient } from "../../liara";
import { createRedactor, selectKnownSecrets, type Redactor } from "../../security/redact";

export const KNOWN_SECRETS_TTL_MS = 60_000;
const MAX_ENTRIES = 200;

type Entry = { expires: number; redactor: Redactor };
const KEY = Symbol.for("hamyar.appRead.logRedactors.v1");

function table(): Map<string, Entry> {
  const g = globalThis as unknown as Record<symbol, Map<string, Entry> | undefined>;
  return (g[KEY] ??= new Map());
}

const PATTERNS_ONLY = createRedactor();

export interface RedactorScope {
  accountId: string;
  teamId?: string;
}

/**
 * Redactor for one app's log lines: pattern rules plus the app's current env values as known secrets. When the
 * env values cannot be read, the pattern-only redactor is returned (and nothing is cached).
 */
export async function logRedactorFor(liara: LiaraClient, scope: RedactorScope, app: string, now: number = Date.now()): Promise<Redactor> {
  const key = `${scope.accountId}|${scope.teamId ?? ""}|${app}`;
  const t = table();
  const hit = t.get(key);
  if (hit && hit.expires > now) return hit.redactor;
  let redactor: Redactor;
  try {
    redactor = createRedactor({ knownSecrets: selectKnownSecrets({ envs: await getEnvs(liara, app) }) });
  } catch {
    return PATTERNS_ONLY;
  }
  for (const [k, v] of t) if (v.expires <= now) t.delete(k);
  while (t.size >= MAX_ENTRIES) {
    const oldest = t.keys().next().value;
    if (oldest === undefined) break;
    t.delete(oldest);
  }
  t.set(key, { expires: now + KNOWN_SECRETS_TTL_MS, redactor });
  return redactor;
}

/** Test hook: drops every cached redactor. */
export function clearLogRedactors(): void {
  table().clear();
}
