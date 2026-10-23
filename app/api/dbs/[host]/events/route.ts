import { getDatabaseEvents } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { toEventDto } from "@/lib/service/app-read/mappers";
import { parseSinceSec } from "@/lib/service/app-read/params";
import { dbFrom, json, type HostCtx } from "@/lib/service/db/route-helpers";

/** `?since=` (unix s / ms / ISO; default 24 h). The Liara events path takes the hostname. Text is masked server-side. */
export const GET = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const startSec = parseSinceSec(new URL(ctx.request.url).searchParams.get("since")) ?? Math.floor(Date.now() / 1000) - 24 * 3600;
  const lines = await getDatabaseEvents(ctx.liara, r.db.hostname, { start: startSec, signal: ctx.request.signal });
  return json({ sinceSec: startSec, events: lines.slice(-200).reverse().map(toEventDto) });
});
