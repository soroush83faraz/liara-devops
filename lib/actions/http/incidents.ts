// Incident and audit read routes. Everything returned is redacted free text or validated identifiers.
import { SAFE_ID_RE } from "@/lib/contracts/common";
import { errorResponse } from "@/lib/server/liara";
import { readAudit } from "@/lib/security/audit";
import { auditIdOf } from "../audit-log";
import { getIncident, listIncidents, renderIncidentMarkdown } from "../incidents";
import { MESSAGES } from "../messages";
import { summarizeIncident, viewIncident } from "../view";
import { errorToResponse, json, parseLimit, type HttpDeps, type RouteCtx } from "./common";

const notFound = () => errorResponse(404, "not_found", MESSAGES.notFound);

export async function handleListIncidents(ctx: RouteCtx, deps: HttpDeps): Promise<Response> {
  try {
    const list = await listIncidents(deps.store, ctx.session.accountId, parseLimit(ctx.request.url, 50, 100));
    return json({ incidents: list.map(summarizeIncident) });
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function handleGetIncident(ctx: RouteCtx, id: string, deps: HttpDeps): Promise<Response> {
  if (!SAFE_ID_RE.test(id)) return notFound();
  try {
    const i = await getIncident(deps.store, ctx.session.accountId, id);
    return i ? json({ incident: viewIncident(i) }) : notFound();
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function handleIncidentMarkdown(ctx: RouteCtx, id: string, deps: HttpDeps): Promise<Response> {
  if (!SAFE_ID_RE.test(id)) return notFound();
  try {
    const i = await getIncident(deps.store, ctx.session.accountId, id);
    if (!i) return notFound();
    return new Response(renderIncidentMarkdown(viewIncident(i)), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `inline; filename="incident-${id}.md"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function handleAudit(ctx: RouteCtx, deps: HttpDeps): Promise<Response> {
  try {
    const entries = await readAudit(deps.store, ctx.session.accountId, { limit: parseLimit(ctx.request.url, 100, 500) });
    return json({ entries: entries.map((e) => ({ id: auditIdOf(e), ...e })) });
  } catch (e) {
    return errorToResponse(e);
  }
}
