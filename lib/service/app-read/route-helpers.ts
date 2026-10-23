import { errorResponse } from "../../server/liara";
import { fa } from "../../i18n/fa";
import { isValidAppName, isValidReleaseId } from "./params";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export const badName = () => errorResponse(400, "bad_name", fa.errors.badRequest);

/** Resolves the `[name]` segment, or a 400 response. */
export async function appNameFrom(params: Promise<{ name: string }>): Promise<{ name: string } | { error: Response }> {
  const { name } = await params;
  return isValidAppName(name) ? { name } : { error: badName() };
}

export async function releaseIdFrom(params: Promise<{ id: string }>): Promise<{ id: string } | { error: Response }> {
  const { id } = await params;
  return isValidReleaseId(id) ? { id } : { error: badName() };
}
