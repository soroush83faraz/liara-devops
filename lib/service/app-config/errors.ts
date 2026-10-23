// Maps OpError (/api/ops) and ApiError (config routes) onto Persian messages. Duck-typed on `status`/`code`
// so both classes work. Server messages are only used for statuses without a dedicated text, and only if
// they contain Persian (route errors are already Persian); anything else falls back to the generic text.
import { t } from "@/lib/i18n/t";

export type ErrorKind =
  | "conflict"
  | "payment"
  | "forbidden"
  | "rate_limited"
  | "auth"
  | "not_found"
  | "typed_name"
  | "bad_request"
  | "unavailable"
  | "network"
  | "generic";

export interface DescribedError {
  kind: ErrorKind;
  message: string;
  /** For rate_limited: seconds the server asked us to wait. */
  retryAfterSec?: number;
}

interface HttpLike {
  status: number;
  code?: string;
  message?: string;
  retryAfterSec?: number;
}

const isHttpLike = (e: unknown): e is HttpLike =>
  typeof e === "object" && e !== null && typeof (e as { status?: unknown }).status === "number";

const hasPersian = (s: string | undefined): s is string => !!s && /[؀-ۿ]/.test(s);

export function describeError(error: unknown): DescribedError {
  if (!isHttpLike(error)) return { kind: "generic", message: t("errors.generic") };
  const { status, code, message, retryAfterSec } = error;
  if (status === 0) return { kind: "network", message: t("errors.network") };
  if (status === 409) return { kind: "conflict", message: t("errors.conflict") };
  if (status === 402 || code === "frozen_project" || code === "payment") {
    return { kind: "payment", message: t("appConfig.errors.payment") };
  }
  if (status === 401) return { kind: "auth", message: t("errors.unauthorizedReconnect") };
  if (status === 429 || code === "rate_limited") {
    return {
      kind: "rate_limited",
      retryAfterSec,
      message:
        retryAfterSec && retryAfterSec > 0
          ? t("errors.rateLimitedCountdown", { seconds: retryAfterSec })
          : t("errors.rateLimited"),
    };
  }
  if (status === 403 && code === "forbidden_origin") return { kind: "forbidden", message: t("errors.forbiddenOrigin") };
  if (status === 403) return { kind: "forbidden", message: t("errors.forbidden") };
  if (status === 404) return { kind: "not_found", message: t("errors.notFound") };
  if (code === "typed_name_mismatch") return { kind: "typed_name", message: t("approval.typeNameMismatch") };
  if (status === 504 || status === 408) return { kind: "unavailable", message: t("errors.liaraTimeout") };
  if (status >= 500) return { kind: "unavailable", message: t("errors.liaraUnavailable") };
  if (status >= 400) {
    return { kind: "bad_request", message: hasPersian(message) ? message : t("errors.badRequest") };
  }
  return { kind: "generic", message: t("errors.generic") };
}

/** Message for a rate-limit countdown that is still running (used by the live countdown in dialogs). */
export function countdownMessage(secondsLeft: number): string {
  return secondsLeft > 0 ? t("errors.rateLimitedCountdown", { seconds: secondsLeft }) : t("appConfig.errors.canRetryNow");
}
