// Server-side: maps thrown errors of the deploy pipeline to {status, code}. Codes are keys of createFlow.errors.
import { isLiaraError, SourceArchiveError, type SourceArchiveErrorCode } from "@/lib/liara";

export interface DeployFailure {
  status: number;
  code: string;
  retryAfterSec?: number;
}

const ARCHIVE: Record<SourceArchiveErrorCode, DeployFailure> = {
  too_large: { status: 413, code: "archive_too_large" },
  unsafe_path: { status: 400, code: "archive_unsafe" },
  symlink: { status: 400, code: "archive_symlink" },
  too_many_files: { status: 400, code: "archive_too_many_files" },
  empty: { status: 400, code: "archive_empty" },
  invalid_zip: { status: 400, code: "archive_invalid" },
};

/** Returns null for errors that the generic `toErrorResponse` already maps well (auth, 5xx, timeouts, ...). */
export function mapDeployError(e: unknown): DeployFailure | null {
  if (e instanceof SourceArchiveError) return ARCHIVE[e.code];
  if (!isLiaraError(e)) return null;
  if (e.code === "frozen_project") return { status: 402, code: "frozen_project" };
  if (e.code === "max_deployment_count_in_day") return { status: 428, code: "deploy_daily_cap" };
  if (e.code === "germany_builder_not_allowed") return { status: 403, code: "germany_builder_not_allowed" };
  if (e.kind === "payment") return { status: 402, code: "payment_required" };
  if (e.status === 413) return { status: 413, code: "upstream_too_large" };
  if (e.kind === "not_found") return { status: 404, code: "not_found" };
  if (e.kind === "conflict") return { status: 409, code: "conflict" };
  return null;
}
