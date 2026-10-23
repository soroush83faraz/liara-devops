import { setDatabasePublicNetwork } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { runUserOp } from "@/lib/server/user-op";
import { parseBody, PublicNetworkBodySchema } from "@/lib/service/db/bodies";
import { badBody, dbFrom, type HostCtx } from "@/lib/service/db/route-helpers";

/** `{enable, typedName}`: exposure change, so the typed hostname is required in both directions. Audited as `db.public_network`. */
export const POST = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const body = await parseBody(ctx.request, PublicNetworkBodySchema);
  if (!body) return badBody();
  const { db } = r;
  return runUserOp({
    ctx,
    action: "db.public_network",
    target: { kind: "db", name: db.hostname },
    params: { hostname: db.hostname, enable: body.enable },
    requireTypedName: true,
    typedName: body.typedName,
    run: async () => {
      await setDatabasePublicNetwork(ctx.liara, db.ref, body.enable);
      return { publicNetwork: body.enable };
    },
  });
});
