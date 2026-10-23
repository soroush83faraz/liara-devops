import { api } from "@/lib/server/liara";
import { handleRevealEnv, type NameParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<NameParams> };

/** The only route that returns an env value: one key per request, rate-limited and audited. */
export const POST = api(async (ctx, { params }: Ctx) => handleRevealEnv(ctx, await params));
