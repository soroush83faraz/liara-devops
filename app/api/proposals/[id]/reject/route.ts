import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleReject } from "@/lib/actions/http/proposals";
import { api } from "@/lib/server/liara";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/proposals/{id}/reject (empty body or `{}`) -> `{proposal}`. */
export const POST = api(async (ctx, { params }: Ctx) => handleReject(ctx, (await params).id, defaultHttpDeps()));
