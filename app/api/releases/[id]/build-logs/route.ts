import { api } from "@/lib/server/liara";
import { appParam, buildLogRedactor, readBuildLogs } from "@/lib/service/app-read/build-logs";
import { badName, json, releaseIdFrom } from "@/lib/service/app-read/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One-shot build output for finished releases (live ones use `/stream`). Last 3000 lines, masked.
 * `?app=<name>` (sent by the UI) adds the app's env values as known secrets; without it only pattern rules apply.
 */
export const GET = api(async ({ liara, session, request }, { params }: Ctx) => {
  const r = await releaseIdFrom(params);
  if ("error" in r) return r.error;
  const a = appParam(new URL(request.url).searchParams);
  if (a.invalid) return badName();
  const redactor = await buildLogRedactor(liara, session, a.app);
  return json(await readBuildLogs(liara, r.id, redactor, request.signal));
});
