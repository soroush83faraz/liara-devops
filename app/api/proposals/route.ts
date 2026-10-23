import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleListProposals } from "@/lib/actions/http/proposals";
import { api } from "@/lib/server/liara";

/** GET /api/proposals?limit=&status= -> `{proposals: Proposal[]}` (newest first). */
export const GET = api((ctx) => handleListProposals(ctx, defaultHttpDeps()));
