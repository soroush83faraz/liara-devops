import { listApplets } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { toAppletDto } from "@/lib/service/app-read/mappers";
import { appNameFrom, json } from "@/lib/service/app-read/route-helpers";

type Ctx = { params: Promise<{ name: string }> };

export const GET = api(async ({ liara, request }, { params }: Ctx) => {
  const r = await appNameFrom(params);
  if ("error" in r) return r.error;
  void request;
  const applets = await listApplets(liara, r.name);
  return json({ applets: applets.map(toAppletDto) });
});
