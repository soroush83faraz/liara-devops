import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleIncidentMarkdown } from "@/lib/actions/http/incidents";
import { api } from "@/lib/server/liara";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/incidents/{id}/markdown -> text/markdown (escaped, redacted). */
export const GET = api(async (ctx, { params }: Ctx) => handleIncidentMarkdown(ctx, (await params).id, defaultHttpDeps()));
