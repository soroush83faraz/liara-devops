import { api } from "@/lib/server/liara";
import { handleCheckDomain, type IdParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<IdParams> };

export const POST = api(async (ctx, { params }: Ctx) => handleCheckDomain(ctx, await params));
