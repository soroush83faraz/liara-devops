import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleOps } from "@/lib/actions/http/ops";
import { api } from "@/lib/server/liara";

/**
 * POST /api/ops — human-initiated operation (see lib/client/ops.ts).
 * Body `{params: ActionParams, typedName?, userValues?}` -> `{ok:true,type,target,summary,after?,auditId?}`.
 */
export const POST = api((ctx) => handleOps(ctx, defaultHttpDeps()));
