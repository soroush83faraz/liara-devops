import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleGetProposal } from "@/lib/actions/http/proposals";
import { api } from "@/lib/server/liara";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/proposals/{id} -> `{proposal}`. */
export const GET = api(async (ctx, { params }: Ctx) => handleGetProposal(ctx, (await params).id, defaultHttpDeps()));
