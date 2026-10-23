import { api } from "@/lib/server/liara";
import { handleResizeDisk, type DiskParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<DiskParams> };

export const POST = api(async (ctx, { params }: Ctx) => handleResizeDisk(ctx, await params));
