// Server-only. The observability routes reuse the canvas overview (same cache entry as GET /api/overview) so that
// opening the dashboard does not repeat the per-app detail calls.
import type { LiaraClient } from "@/lib/liara";
import { collectOverview } from "@/lib/canvas/collect";
import { globalCache } from "@/lib/canvas/ttl-cache";
import type { Overview } from "@/lib/canvas/types";

/** Must match app/api/overview/route.ts: the first caller creates the shared cache with its TTL. */
const OVERVIEW_TTL_MS = 10_000;

export function cachedOverview(liara: LiaraClient, scope: { accountId: string; teamId?: string }): Promise<Overview> {
  return globalCache<Overview>("overview", OVERVIEW_TTL_MS).get(`${scope.accountId}:${scope.teamId ?? ""}`, () => collectOverview(liara));
}
