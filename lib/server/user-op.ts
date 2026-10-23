// One wrapper for every human-initiated mutation that is NOT an AI-proposable ActionType (domain add, SSL,
// toggles, disk create/resize, DB settings, backups …). Guarantees, in order: per-account rate limit, typed
// resource name when required, execution (never auto-retried), best-effort audit (redacted), safe error mapping.
// Origin + session checks come from `api()` (lib/server/liara.ts), so call this inside an `api(...)` handler.
import { unstable_rethrow } from "next/navigation";
import { fa } from "../i18n/fa";
import {
  appendAudit,
  assertRateLimit,
  assertTypedName,
  getDefaultStore,
  hashParams,
  PolicyError,
} from "../security";
import type { TargetKindT } from "./user-op-types";
import { errorResponse, toErrorResponse, type ApiContext } from "./liara";

export interface UserOpSpec<T> {
  ctx: ApiContext;
  /** Audit action code, e.g. "domain.add", "ssl.provision", "disk.create", "db.public_network". */
  action: string;
  target: { kind: TargetKindT; name: string };
  /** Secret-free description of the parameters (hashed for the audit trail). */
  params: unknown;
  /** Require the user to have typed the target name (billed, destructive or exposure-changing ops). */
  requireTypedName?: boolean;
  typedName?: unknown;
  /** Values that must be scrubbed from the audit entry if they ever appear (e.g. a DB password). */
  knownSecrets?: string[];
  run: () => Promise<T>;
}

const FA = fa.actionsMsg.userOp;

export async function runUserOp<T extends Record<string, unknown>>(spec: UserOpSpec<T>): Promise<Response> {
  const { ctx, action, target } = spec;
  const store = getDefaultStore();
  let paramsHash = "0".repeat(64);
  try {
    paramsHash = hashParams(spec.params ?? {});
  } catch {
    /* non-canonicalisable params: keep the zero hash rather than failing the op */
  }
  const audit = async (result: "ok" | "error" | "denied", detail?: string) => {
    try {
      await appendAudit(
        store,
        ctx.session.accountId,
        { actor: "user", action, target, paramsHash, result, detail },
        { knownSecrets: spec.knownSecrets },
      );
    } catch {
      /* the audit trail is best-effort; never let it mask the real outcome */
    }
  };
  try {
    assertRateLimit(`userop:${ctx.session.accountId}`, 30, 60_000);
    if (spec.requireTypedName) assertTypedName(spec.typedName, target.name);
    const result = await spec.run();
    await audit("ok");
    return Response.json({ ok: true, action, target, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof PolicyError) {
      await audit("denied", error.code);
      if (error.code === "typed_name_mismatch") return errorResponse(400, "typed_name_mismatch", FA.typedMismatch);
      if (error.code === "rate_limited") {
        return errorResponse(429, "rate_limited", FA.rateLimited, {
          retryAfterSec: error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1000) : undefined,
        });
      }
      return errorResponse(403, error.code, FA.typedMismatch);
    }
    await audit("error", error instanceof Error ? error.name : "error");
    return toErrorResponse(error);
  }
}
