import { setDatabaseControlPanel } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { runUserOp } from "@/lib/server/user-op";
import { ControlPanelBodySchema, parseBody } from "@/lib/service/db/bodies";
import { badBody, dbFrom, type HostCtx } from "@/lib/service/db/route-helpers";

/** `{enable, typedName?}`: the web control panel is an extra public entry point, so enabling needs the typed hostname. Audited as `db.control_panel`. */
export const POST = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const body = await parseBody(ctx.request, ControlPanelBodySchema);
  if (!body) return badBody();
  const { db } = r;
  return runUserOp({
    ctx,
    action: "db.control_panel",
    target: { kind: "db", name: db.hostname },
    params: { hostname: db.hostname, enable: body.enable },
    requireTypedName: body.enable,
    typedName: body.typedName,
    run: async () => {
      const controlPanelID = await setDatabaseControlPanel(ctx.liara, db.ref, body.enable);
      return { enabled: body.enable, ...(controlPanelID ? { controlPanelId: controlPanelID } : {}) };
    },
  });
});
