import { api } from "@/lib/server/liara";
import { handleCreateDisk, handleListDisks, type NameParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<NameParams> };

export const GET = api(async (ctx, { params }: Ctx) => handleListDisks(ctx, await params));
export const POST = api(async (ctx, { params }: Ctx) => handleCreateDisk(ctx, await params));
