import { getMe, listDbPlans } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { buildPlanOptions } from "@/lib/service/db/plans";
import { dbFrom, json, type HostCtx } from "@/lib/service/db/route-helpers";
import type { DbPlansDto } from "@/lib/service/db/types";

/** Purchasable plans for this engine with the price delta against the current plan (resize dialog). */
export const GET = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const { summary } = r.db;
  const engine = (summary.type ?? "").toLowerCase();
  const me = await getMe(ctx.liara);
  const filter = { region: "any", includeLegacy: true, engine } as const;
  const dto: DbPlansDto = {
    engine,
    ...(summary.planID ? { currentPlanID: summary.planID } : {}),
    plans: buildPlanOptions(
      listDbPlans(me, { ...filter, availableOnly: true, includeLegacy: false }),
      listDbPlans(me, { ...filter, availableOnly: false }),
      summary.planID,
    ),
  };
  return json(dto);
});
