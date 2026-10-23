import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleAudit } from "@/lib/actions/http/incidents";
import { api } from "@/lib/server/liara";

/** GET /api/audit?limit= -> `{entries: Array<AuditEntry & {id}>}` (newest first, max 500). */
export const GET = api((ctx) => handleAudit(ctx, defaultHttpDeps()));
