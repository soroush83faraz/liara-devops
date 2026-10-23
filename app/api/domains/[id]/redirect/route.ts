import { api } from "@/lib/server/liara";
import { handleDomainRedirect, type IdParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<IdParams> };

export const POST = api(async (ctx, { params }: Ctx) => handleDomainRedirect(ctx, await params));
