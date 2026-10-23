import { api } from "@/lib/server/liara";
import { handleToggle, type NameParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<NameParams> };

export const POST = api(async (ctx, { params }: Ctx) => handleToggle(ctx, await params));
