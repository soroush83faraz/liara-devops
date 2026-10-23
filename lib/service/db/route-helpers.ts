import { fa } from "../../i18n/fa";
import { errorResponse, type ApiContext } from "../../server/liara";
import { DB_PARAM_RE, resolveDatabase, type ResolvedDb } from "./resolve";

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export type HostCtx = { params: Promise<{ host: string }> };

export const accountKey = (ctx: ApiContext) => `${ctx.session.accountId}:${ctx.session.teamId ?? ""}`;

/** Resolves the `[host]` segment (hostname or ref) to a database, or returns the error response (400/404). */
export async function dbFrom(ctx: ApiContext, params: Promise<{ host: string }>): Promise<{ db: ResolvedDb } | { error: Response }> {
  const { host } = await params;
  if (!DB_PARAM_RE.test(host)) return { error: errorResponse(400, "bad_name", fa.errors.badRequest) };
  const db = await resolveDatabase(ctx.liara, accountKey(ctx), host);
  return db ? { db } : { error: errorResponse(404, "not_found", fa.errors.notFound) };
}

export const badBody = () => errorResponse(400, "bad_body", fa.errors.badRequest);
