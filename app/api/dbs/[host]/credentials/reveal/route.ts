import { getDatabaseCredentials, invalidArgument } from "@/lib/liara";
import { assertRateLimit } from "@/lib/security";
import { api } from "@/lib/server/liara";
import { runUserOp } from "@/lib/server/user-op";
import { dbFrom, type HostCtx } from "@/lib/service/db/route-helpers";

/**
 * The ONLY route that returns a database password. Origin-checked by `api()`, rate-limited (10/min per account),
 * audited as `db.credentials.reveal` (the audit entry never contains the secret), `Cache-Control: no-store`.
 * The UI keeps the value in component state only and hides it after 15 s.
 */
export const POST = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const { db } = r;
  return runUserOp({
    ctx,
    action: "db.credentials.reveal",
    target: { kind: "db", name: db.hostname },
    params: { hostname: db.hostname },
    run: async () => {
      assertRateLimit(`dbreveal:${ctx.session.accountId}`, 10, 60_000);
      const creds = await getDatabaseCredentials(ctx.liara, db.ref);
      if (!creds.password) throw invalidArgument("Liara did not return a password for this database");
      return { username: creds.username ?? null, secret: creds.password };
    },
  });
});
