import { api } from "@/lib/server/liara";
import { handleGetSettings, type NameParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<NameParams> };

export const GET = api(async (ctx, { params }: Ctx) => handleGetSettings(ctx, await params));
