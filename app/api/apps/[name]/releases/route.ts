import { listReleases } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { toReleaseDto } from "@/lib/service/app-read/mappers";
import { intParam } from "@/lib/service/app-read/params";
import { appNameFrom, json } from "@/lib/service/app-read/route-helpers";
import type { ReleasesPageDto } from "@/lib/service/app-read/types";

type Ctx = { params: Promise<{ name: string }> };

export const GET = api(async ({ liara, request }, { params }: Ctx) => {
  const r = await appNameFrom(params);
  if ("error" in r) return r.error;
  const sp = new URL(request.url).searchParams;
  const page = intParam(sp.get("page"), 1, 1, 10_000);
  const count = intParam(sp.get("count"), 10, 1, 50);
  const res = await listReleases(liara, r.name, { page, count });
  const body: ReleasesPageDto = {
    total: res.total ?? res.releases.length,
    page,
    count,
    ...(res.currentRelease ? { currentRelease: res.currentRelease } : {}),
    releases: res.releases.map((x) => toReleaseDto(x, { currentReleaseId: res.currentRelease })),
  };
  return json(body);
});
