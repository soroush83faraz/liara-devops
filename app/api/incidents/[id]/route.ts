import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleGetIncident } from "@/lib/actions/http/incidents";
import { api } from "@/lib/server/liara";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/incidents/{id} -> `{incident}`. */
export const GET = api(async (ctx, { params }: Ctx) => handleGetIncident(ctx, (await params).id, defaultHttpDeps()));
