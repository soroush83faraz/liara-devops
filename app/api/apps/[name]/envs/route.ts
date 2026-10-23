import { api } from "@/lib/server/liara";
import { handleListEnvs, type NameParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<NameParams> };

/** Masked list only (key, encrypted, valueLength). Values never leave through this route. */
export const GET = api(async (ctx, { params }: Ctx) => handleListEnvs(ctx, await params));
