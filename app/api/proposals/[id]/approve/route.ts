import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleApprove } from "@/lib/actions/http/proposals";
import { api } from "@/lib/server/liara";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/proposals/{id}/approve `{typedName?}` -> `{approvalToken, expiresAt, proposal}`; stale -> 409. */
export const POST = api(async (ctx, { params }: Ctx) => handleApprove(ctx, (await params).id, defaultHttpDeps()));
