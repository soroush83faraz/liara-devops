import { getAppEvents } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { toEventDto } from "@/lib/service/app-read/mappers";
import { parseSinceSec } from "@/lib/service/app-read/params";
import { appNameFrom, json } from "@/lib/service/app-read/route-helpers";

type Ctx = { params: Promise<{ name: string }> };

export const GET = api(async ({ liara, request }, { params }: Ctx) => {
  const r = await appNameFrom(params);
  if ("error" in r) return r.error;
  const startSec = parseSinceSec(new URL(request.url).searchParams.get("since")) ?? Math.floor(Date.now() / 1000) - 24 * 3600;
  const lines = await getAppEvents(liara, r.name, { start: startSec, signal: request.signal });
  return json({ sinceSec: startSec, events: lines.slice(-200).reverse().map(toEventDto) });
});
