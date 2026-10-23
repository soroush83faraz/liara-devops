import { getAccountBilling, getMe, listNetworks } from "@/lib/liara";
import { globalCache } from "@/lib/canvas/ttl-cache";
import { normalizePlans } from "@/lib/create/plans";
import type { PlansResponse } from "@/lib/create/types";
import { api } from "@/lib/server/liara";

const TTL_MS = 60_000;

/**
 * Plans, DB versions, networks and balance for the create wizards, normalised from `GET /v1/me`.
 * Cached ~60 s per account (+ team). Missing pieces are omitted and reported in `partial`; prices are never invented.
 */
export const GET = api(async ({ liara, session, request }) => {
  const cache = globalCache<PlansResponse>("create.plans", TTL_MS);
  // `?fresh=1` (after the user created a network) drops the cache so the new network is listed.
  if (new URL(request.url).searchParams.get("fresh") === "1") cache.clear();
  const key = `${session.accountId}:${session.teamId ?? ""}`;
  const data = await cache.get(key, async () => {
    const [me, billing, networks] = await Promise.all([
      getMe(liara),
      getAccountBilling(liara).then((b) => b, () => undefined),
      listNetworks(liara).then((n) => n, () => undefined),
    ]);
    return normalizePlans({
      me,
      balanceToman: billing?.balance,
      balanceUnreadable: billing ? billing.teamUnreadable : Boolean(liara.teamId),
      teamId: liara.teamId || undefined,
      networks: networks?.flatMap((n) => (n._id && n.name ? [{ id: n._id, name: n.name }] : [])),
    });
  });
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
});
