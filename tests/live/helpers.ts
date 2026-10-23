import { z } from "zod";
import { createLiaraClient, listApps, type LiaraClient } from "../../lib/liara";

// Optional local env files (Node 22). Missing files are fine.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* not present */
  }
}

export const TOKEN = process.env.LIARA_API_TOKEN ?? "";
export const TEAM_ID = process.env.LIARA_TEAM_ID ?? "";
export const TEST_APP = process.env.LIARA_TEST_APP ?? "";
/** Mutating / billed tests need this explicit opt-in AND a named test app. */
export const ALLOW_BILLED = process.env.ALLOW_BILLED_LIVE_TESTS === "1";
export const HAS_TOKEN = TOKEN.length > 0;

export function liveClient(extra: Partial<Parameters<typeof createLiaraClient>[0]> = {}): LiaraClient {
  // describe bodies run even when the suite is skipped, so never throw on a missing token here.
  return createLiaraClient({ token: TOKEN || "unset", teamId: TEAM_ID, timeoutMs: 30_000, ...extra });
}

/** Keys-only structural summary: objects -> key map, arrays -> {_len, _item}, scalars -> typeof. Never contains values. */
export function shape(v: unknown, depth = 4): unknown {
  if (v === null) return "null";
  if (Array.isArray(v)) return { _len: v.length, _item: v.length && depth > 0 ? shape(v[0], depth - 1) : undefined };
  if (typeof v === "object") {
    if (depth <= 0) return "{...}";
    return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shape(x, depth - 1)]));
  }
  return typeof v;
}

export function report(label: string, data: unknown): void {
  console.info(`[live] ${label}\n${JSON.stringify(data, null, 1)}`);
}

/** Distinct values of an enum-like field (statuses are not secrets; do not use on free-form fields). */
export function distinct(items: ReadonlyArray<Record<string, unknown>>, key: string): string[] {
  return [...new Set(items.map((i) => i[key]).filter((x): x is string => typeof x === "string"))].sort();
}

/** The app reads run against: LIARA_TEST_APP if set, else the first app of the account. */
export async function pickReadApp(client: LiaraClient): Promise<string | undefined> {
  if (TEST_APP) return TEST_APP;
  return (await listApps(client))[0]?.project_id;
}

export const anyBody = z.unknown();
