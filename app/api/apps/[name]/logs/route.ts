import { getRuntimeLogs } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { logRedactorFor } from "@/lib/service/app-read/known-secrets";
import { toLogLineDtos } from "@/lib/service/app-read/mappers";
import { intParam, isValidReleaseId, parseSinceSec } from "@/lib/service/app-read/params";
import { appNameFrom, badName, json } from "@/lib/service/app-read/route-helpers";

type Ctx = { params: Promise<{ name: string }> };

const DEFAULT_WINDOW_SEC = 3600;

/**
 * One-shot runtime logs: `?since=<unix s | ISO>&releaseId=&limit=` (limit 1..2000, default 500; newest lines kept).
 * Lines are masked as a batch with the app's own env values as known secrets (never returned).
 */
export const GET = api(async ({ liara, session, request }, { params }: Ctx) => {
  const r = await appNameFrom(params);
  if ("error" in r) return r.error;
  const sp = new URL(request.url).searchParams;
  const releaseId = sp.get("releaseId") || undefined;
  if (releaseId && !isValidReleaseId(releaseId)) return badName();
  const limit = intParam(sp.get("limit"), 500, 1, 2000);
  const startSec = parseSinceSec(sp.get("since")) ?? Math.floor(Date.now() / 1000) - DEFAULT_WINDOW_SEC;
  const [{ lines, source }, redactor] = await Promise.all([
    getRuntimeLogs(liara, r.name, { startSec, releaseId, signal: request.signal }),
    logRedactorFor(liara, session, r.name),
  ]);
  return json({
    source,
    sinceSec: startSec,
    truncated: lines.length > limit,
    lines: toLogLineDtos(lines.slice(-limit), redactor),
  });
});
