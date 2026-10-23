// POST /api/agent: streaming Persian copilot (AI SDK v7 UI-message stream with typed `data-*` parts).
// api() enforces the session (401) and same-origin (403) before anything else runs.
import { handleAgentPost } from "@/lib/agent/handler";
import { api } from "@/lib/server/liara";

// With cacheComponents a POST route handler is always dynamic; only the duration is configured.
export const maxDuration = 120;

export const POST = api(({ session, liara, request }) => handleAgentPost({ session, liara, request }));
