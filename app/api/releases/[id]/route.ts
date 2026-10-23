import { getRelease } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { toReleaseDto } from "@/lib/service/app-read/mappers";
import { json, releaseIdFrom } from "@/lib/service/app-read/route-helpers";

type Ctx = { params: Promise<{ id: string }> };

/** Release detail: state, failReason, queue, git info, times. */
export const GET = api(async ({ liara, request }, { params }: Ctx) => {
  const r = await releaseIdFrom(params);
  if ("error" in r) return r.error;
  const release = await getRelease(liara, r.id, request.signal);
  return json(toReleaseDto(release));
});
