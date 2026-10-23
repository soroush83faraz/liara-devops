import { createDatabaseBackup, listDatabaseBackups } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { runUserOp } from "@/lib/server/user-op";
import { toBackupDtos } from "@/lib/service/db/dto";
import { dbFrom, json, type HostCtx } from "@/lib/service/db/route-helpers";

export const GET = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  return json({ backups: toBackupDtos(await listDatabaseBackups(ctx.liara, r.db.ref)) });
});

/** Creates a backup (not billed per Liara docs [VAL]; audited as `db.backup.create`). There is no restore API [NF]. */
export const POST = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const { db } = r;
  return runUserOp({
    ctx,
    action: "db.backup.create",
    target: { kind: "db", name: db.hostname },
    params: { hostname: db.hostname },
    run: async () => {
      await createDatabaseBackup(ctx.liara, db.ref);
      return {};
    },
  });
});
