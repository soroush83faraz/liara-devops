import { scaleDatabase } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { runUserOp } from "@/lib/server/user-op";
import { parseBody, PowerBodySchema } from "@/lib/service/db/bodies";
import { badBody, dbFrom, type HostCtx } from "@/lib/service/db/route-helpers";

/** `{scale: 0|1, typedName}`: stop (0) or start (1). Stopping drops every connection, so the typed name is required. Audited as `db.power`. */
export const POST = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const body = await parseBody(ctx.request, PowerBodySchema);
  if (!body) return badBody();
  const { db } = r;
  return runUserOp({
    ctx,
    action: "db.power",
    target: { kind: "db", name: db.hostname },
    params: { hostname: db.hostname, scale: body.scale },
    requireTypedName: true,
    typedName: body.typedName,
    run: async () => {
      await scaleDatabase(ctx.liara, db.ref, body.scale);
      return { scale: body.scale };
    },
  });
});
