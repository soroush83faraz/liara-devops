import { getDatabase } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { buildConnectionDto } from "@/lib/service/db/connection";
import { dbFrom, json, type HostCtx } from "@/lib/service/db/route-helpers";

/** Connection details WITHOUT the password: strings carry the `<PASSWORD>` placeholder. Reveal is a separate, audited route. */
export const GET = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const detail = await getDatabase(ctx.liara, r.db.ref);
  return json(buildConnectionDto({ ...detail, hostname: detail.hostname ?? r.db.hostname }));
});
