import { getDatabase, getMe, listDbPlans, listNetworks } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { toOverviewDto } from "@/lib/service/db/dto";
import { dbFrom, json, type HostCtx } from "@/lib/service/db/route-helpers";

/** Database facts for the overview tab. The Liara detail is parsed with the credential-free schema: no password here. */
export const GET = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const { db } = r;
  const [detail, me, networks] = await Promise.allSettled([getDatabase(ctx.liara, db.ref), getMe(ctx.liara), listNetworks(ctx.liara)]);
  if (detail.status === "rejected") throw detail.reason;

  const plan =
    me.status === "fulfilled"
      ? listDbPlans(me.value, { availableOnly: false, region: "any", includeLegacy: true }).find((p) => p.id === (detail.value.planID ?? db.summary.planID))
      : undefined;
  const netId = detail.value.network?._id;
  const networkName = netId && networks.status === "fulfilled" ? networks.value.find((n) => n._id === netId)?.name : undefined;

  return json(toOverviewDto(detail.value, { hostname: db.hostname, summary: db.summary, plan, networkName }));
});
