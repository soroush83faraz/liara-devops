import { getDatabaseBackupLink } from "@/lib/liara";
import { fa } from "@/lib/i18n/fa";
import { api, errorResponse } from "@/lib/server/liara";
import { runUserOp } from "@/lib/server/user-op";
import { isValidBackupName } from "@/lib/service/db/bodies";
import { dbFrom } from "@/lib/service/db/route-helpers";

type Ctx = { params: Promise<{ host: string; name: string }> };

/** Download link for one backup (audited as `db.backup.link`). The link is signed by Liara and expires; its lifetime is not documented [VAL]. */
export const POST = api(async (ctx, { params }: Ctx) => {
  const { name } = await params;
  if (!isValidBackupName(name)) return errorResponse(400, "bad_name", fa.errors.badRequest);
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const { db } = r;
  return runUserOp({
    ctx,
    action: "db.backup.link",
    target: { kind: "db", name: db.hostname },
    params: { hostname: db.hostname, backup: name },
    run: async () => ({ link: await getDatabaseBackupLink(ctx.liara, db.ref, name) }),
  });
});
