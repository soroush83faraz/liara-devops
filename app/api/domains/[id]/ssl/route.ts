import { api } from "@/lib/server/liara";
import { handleDomainSsl, type IdParams } from "@/lib/service/app-config/handlers";

type Ctx = { params: Promise<IdParams> };

/** Body `{enable: boolean, typedName?}`: provision (or disable, which needs the typed domain name). */
export const POST = api(async (ctx, { params }: Ctx) => handleDomainSsl(ctx, await params));
