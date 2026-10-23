import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleListIncidents } from "@/lib/actions/http/incidents";
import { api } from "@/lib/server/liara";

/** GET /api/incidents?limit= -> `{incidents: IncidentSummary[]}` (newest first). */
export const GET = api((ctx) => handleListIncidents(ctx, defaultHttpDeps()));
