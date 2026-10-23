// Maps failures (from /api/ops, /api/apps/[name]/deploy, fetch) to a key of createFlow.errors. Client-safe.
import type { createFlow } from "@/lib/i18n/ns/createFlow";

export type ErrorKey = keyof typeof createFlow.errors;

export interface ErrLike {
  status?: number;
  code?: string;
  retryAfterSec?: number;
}

/** Duck-typed so it accepts OpError, ApiError and plain objects without importing them. */
export function toErrLike(e: unknown): ErrLike {
  if (typeof e === "object" && e !== null) {
    const o = e as Record<string, unknown>;
    return {
      status: typeof o.status === "number" ? o.status : undefined,
      code: typeof o.code === "string" ? o.code : undefined,
      retryAfterSec: typeof o.retryAfterSec === "number" ? o.retryAfterSec : undefined,
    };
  }
  return {};
}

const BY_CODE: Partial<Record<string, ErrorKey>> = {
  typed_name_mismatch: "typedNameMismatch",
  free_plan_platform: "freePlanPlatform",
  frozen_project: "frozenProject",
  payment_required: "paymentRequired",
  deploy_daily_cap: "deployDailyCap",
  archive_too_large: "archiveTooLarge",
  upstream_too_large: "archiveTooLarge",
  archive_unsafe: "archiveUnsafe",
  archive_symlink: "archiveSymlink",
  archive_too_many_files: "archiveTooManyFiles",
  archive_empty: "archiveEmpty",
  archive_invalid: "archiveInvalid",
  archive_type_mismatch: "archiveTypeMismatch",
  unsupported_media_type: "unsupportedMedia",
  length_required: "lengthRequired",
  bad_fields: "badFields",
  app_stopped: "appStopped",
  forbidden_origin: "forbiddenOrigin",
  germany_builder_not_allowed: "forbidden",
};

/**
 * Persian message key for a failure. `create` = wizard ops (409 means the name is taken),
 * `deploy` = release creation (409 means another operation is running).
 */
export function errorKeyFor(e: ErrLike, ctx: "create" | "deploy"): ErrorKey {
  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code]!;
  switch (e.status) {
    case 0:
    case undefined:
      return "network";
    case 400:
      return "badFields";
    case 401:
      return "unauthorized";
    case 402:
      return "paymentRequired";
    case 403:
      return "forbidden";
    case 404:
      return "notFound";
    case 409:
      return ctx === "create" ? "nameTaken" : "busy";
    case 411:
      return "lengthRequired";
    case 413:
      return "archiveTooLarge";
    case 415:
      return "unsupportedMedia";
    case 428:
      return "deployDailyCap";
    case 429:
      return "rateLimited";
    default:
      return (e.status ?? 0) >= 500 ? "liaraUnavailable" : "generic";
  }
}
