import { getApp, getAppEvents, getAppMetricsSummary, listApplets, listReleases } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { assembleOverview, part } from "@/lib/service/app-read/overview";
import { appNameFrom, json } from "@/lib/service/app-read/route-helpers";

type Ctx = { params: Promise<{ name: string }> };

/** Overview of one app. Env values are never read into the response; failed sub-calls become `{unavailable:true}`. */
export const GET = api(async ({ liara, request }, { params }: Ctx) => {
  const r = await appNameFrom(params);
  if ("error" in r) return r.error;
  const { name } = r;
  const signal = request.signal;
  const startSec = Math.floor(Date.now() / 1000) - 24 * 3600;
  const [app, applets, releases, events, usage] = await Promise.allSettled([
    getApp(liara, name),
    listApplets(liara, name),
    listReleases(liara, name, { page: 1, count: 1 }),
    getAppEvents(liara, name, { start: startSec, signal }),
    getAppMetricsSummary(liara, name),
  ]);
  if (app.status === "rejected") throw app.reason; // the app itself is required: mapped to a safe 401/404/5xx
  return json(
    assembleOverview({
      name,
      app: app.value,
      applets: part(applets),
      releases: part(releases),
      events: part(events),
      usage: part(usage),
    }),
  );
});
