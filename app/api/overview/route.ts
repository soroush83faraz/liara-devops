import { api } from "@/lib/server/liara";
import { collectOverview } from "@/lib/canvas/collect";
import { globalCache } from "@/lib/canvas/ttl-cache";
import type { Overview } from "@/lib/canvas/types";

const OVERVIEW_TTL_MS = 10_000;

/** GET /api/overview: apps + databases + networks + balance, normalised for the canvas. No env values or secrets. */
export const GET = api(async ({ liara, session }) => {
  const key = `${session.accountId}:${session.teamId ?? ""}`;
  const overview = await globalCache<Overview>("overview", OVERVIEW_TTL_MS).get(key, () => collectOverview(liara));
  return Response.json(overview, { headers: { "Cache-Control": "no-store" } });
});
