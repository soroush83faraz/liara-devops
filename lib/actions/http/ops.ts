// POST /api/ops — human-initiated operations. The user's own click (plus the typed resource name where the
// policy requires it, validated here) is the approval; tier-3 deletes exist only on this path (source 'user').
// Order: strict origin -> rate limit -> body (strict schema) -> policy/typed name -> target lock ->
// executeAction (never retried) -> audit (with knownSecrets) -> response.
import { z } from "zod";
import { ActionParamsSchema, actionTarget } from "@/lib/contracts/action";
import { UserEnvValuesSchema } from "@/lib/contracts/env";
import { PolicyError, assertTypedName, requiredConfirmation } from "@/lib/security/policy";
import { hashParams } from "@/lib/security/canonical";
import { errorResponse } from "@/lib/server/liara";
import { auditIdOf, auditSafe } from "../audit-log";
import { ActionError, toActionError } from "../errors";
import { executeAction } from "../executors";
import { targetLockKey, tryLockTarget } from "../globals";
import { MESSAGES, messageFor } from "../messages";
import { actionErrorResponse, badRequest, guardMutation, json, readJsonBody, type HttpDeps, type RouteCtx } from "./common";

const OPS_MAX_BYTES = 1024 * 1024;
const OPS_PER_MINUTE = 20;

export const OpsBodySchema = z.strictObject({
  params: ActionParamsSchema,
  typedName: z.string().max(512).optional(),
  userValues: UserEnvValuesSchema.optional(),
});

const DENIED = new Set(["human_only", "ai_not_allowed", "use_proposal_flow", "missing_user_value", "unexpected_user_value", "invalid", "conflict"]);

export async function handleOps(ctx: RouteCtx, deps: HttpDeps): Promise<Response> {
  const guard = guardMutation(ctx, deps, "ops", OPS_PER_MINUTE);
  if (guard) return guard;
  const body = await readJsonBody(ctx.request, OPS_MAX_BYTES);
  if (!body.ok) return body.response;
  const parsed = OpsBodySchema.safeParse(body.value);
  if (!parsed.success) return badRequest(parsed.error.issues);

  const { params, typedName, userValues } = parsed.data;
  const accountId = ctx.session.accountId;
  const target = actionTarget(params);
  const paramsHash = hashParams(params);
  const audit = (result: "ok" | "error" | "denied", detail: string, knownSecrets?: readonly string[]) =>
    auditSafe(deps.store, accountId, { actor: "user", action: params.type, target, paramsHash, result, detail }, { knownSecrets, now: deps.now() });

  // A deploy plan runs for minutes with streamed progress: it goes through the proposal flow (SSE), not here.
  if (params.type === "deploy_plan") {
    await audit("denied", "use_proposal_flow");
    return actionErrorResponse(new ActionError("use_proposal_flow"));
  }
  const conf = requiredConfirmation(params.type);
  if (conf.typedName || conf.tier >= 2) {
    try {
      assertTypedName(typedName, target.name);
    } catch (e) {
      if (!(e instanceof PolicyError)) throw e;
      await audit("denied", "typed_name_mismatch");
      return errorResponse(400, "typed_name_mismatch", MESSAGES.typedNameMismatch);
    }
  }

  const release = tryLockTarget(targetLockKey(accountId, ctx.session.teamId ?? "", target));
  if (!release) {
    await audit("denied", "target_busy");
    return errorResponse(409, "conflict", messageFor("conflict"), { details: { reason: "target_busy" } });
  }
  try {
    // Not tied to the request signal: aborting a mutation half-way would only make its outcome unknown.
    const result = await executeAction({ liara: ctx.liara, accountId }, params, { userValues, source: "user" });
    const entry = await audit("ok", result.confirmedByReread ? "ok; confirmed_by_reread" : "ok", result.knownSecrets);
    return json({
      ok: true,
      type: params.type,
      target,
      summary: result.summary,
      ...(result.after ? { after: result.after } : {}),
      ...(entry ? { auditId: auditIdOf(entry) } : {}),
    });
  } catch (e) {
    const err = toActionError(e);
    await audit(DENIED.has(err.code) ? "denied" : "error", err.code, err.knownSecrets);
    return actionErrorResponse(err);
  } finally {
    release();
  }
}
