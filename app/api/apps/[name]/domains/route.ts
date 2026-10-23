import { api } from "@/lib/server/liara";
import { handleAddDomain, handleListDomains, type NameParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<NameParams> };

export const GET = api(async (ctx, { params }: Ctx) => handleListDomains(ctx, await params));
export const POST = api(async (ctx, { params }: Ctx) => handleAddDomain(ctx, await params));
