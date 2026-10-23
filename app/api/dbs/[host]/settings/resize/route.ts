import { getMe, invalidArgument, listDbPlans, resizeDatabase } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { runUserOp } from "@/lib/server/user-op";
import { parseBody, ResizeBodySchema } from "@/lib/service/db/bodies";
import { comparePlans } from "@/lib/service/db/plans";
import { badBody, dbFrom, type HostCtx } from "@/lib/service/db/route-helpers";

/**
 * `{planID, disk?, typedName}`: BILLED, so the typed hostname is required. The target must be a purchasable plan that
 * supports this engine (checked against `GET /v1/me` at execution time); the response carries the price delta.
 * Audited as `db.resize`. Downtime and the meaning of `disk` are unverified [VAL].
 */
export const POST = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const body = await parseBody(ctx.request, ResizeBodySchema);
  if (!body) return badBody();
  const { db } = r;
  const engine = (db.summary.type ?? "").toLowerCase();
  return runUserOp({
    ctx,
    action: "db.resize",
    target: { kind: "db", name: db.hostname },
    params: { hostname: db.hostname, planID: body.planID, disk: body.disk ?? null },
    requireTypedName: true,
    typedName: body.typedName,
    run: async () => {
      const me = await getMe(ctx.liara);
      const target = listDbPlans(me, { availableOnly: true, region: "any", includeLegacy: true, engine }).find((p) => p.id === body.planID);
      if (!target) throw invalidArgument("The requested plan is not available for this database");
      const current = listDbPlans(me, { availableOnly: false, region: "any", includeLegacy: true }).find((p) => p.id === db.summary.planID);
      await resizeDatabase(ctx.liara, db.ref, body.planID, body.disk);
      return { planID: body.planID, cost: { ...(target.priceKnown ? { perHour: target.pricePerHour, perMonth: target.pricePerMonth } : {}), ...comparePlans(current, target) } };
    },
  });
});
