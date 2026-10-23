// What the canvas says when /api/overview fails. Reuses the panel tabs' mapping (lib/service/app-config/errors) so a
// 502/504 reads «لیارا در حال حاضر در دسترس نیست»/«لیارا پاسخ نداد» and a 429 carries its retry-after for a live
// countdown, instead of a generic «مشکلی پیش آمد».
import { describeError, type DescribedError } from "@/lib/service/app-config/errors";
import { t } from "@/lib/i18n/t";
import { ApiError } from "./use-overview";

export interface CanvasLoadError {
  kind: DescribedError["kind"];
  message: string;
  /** Present for 429: seconds until the automatic retry. */
  retryAfterSec?: number;
}

export function canvasLoadError(error: unknown): CanvasLoadError {
  if (error instanceof ApiError) {
    const d = describeError({ status: error.status, code: error.code, retryAfterSec: error.retryAfterSec });
    if (d.kind === "rate_limited") return { kind: d.kind, message: d.message, ...(d.retryAfterSec ? { retryAfterSec: d.retryAfterSec } : {}) };
    if (d.kind === "unavailable") {
      return { kind: d.kind, message: error.status === 504 || error.status === 408 ? t("canvasMap.errors.upstreamTimeout") : t("canvasMap.errors.upstreamUnavailable") };
    }
    return { kind: d.kind, message: d.message };
  }
  // fetch() itself failed (offline, DNS): not a Liara answer.
  if (error instanceof TypeError) return { kind: "network", message: t("errors.network") };
  return { kind: "generic", message: t("errors.generic") };
}
