import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleEvents } from "@/lib/actions/http/proposals";
import { api } from "@/lib/server/liara";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/proposals/{id}/events — SSE. Each `data:` frame is one CopilotStreamEvent JSON (data-execution,
 * data-verification, data-proposal, data-error); `: hb` comments every 15 s; ends on the terminal status.
 */
export const GET = api(async (ctx, { params }: Ctx) => handleEvents(ctx, (await params).id, defaultHttpDeps()));
