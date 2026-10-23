// Wire types of GET /api/observability (and /errors). Client-safe: no server imports, no secrets.
import type { ServiceStatus } from "@/components/ui/status";
import type { OverviewNetwork, ServiceKind } from "@/lib/canvas/types";
import type { LogLevel, MetricRange, MetricsDto, MetricsUnavailableDto } from "@/lib/service/app-read/types";

/** At most this many services are queried per response; the rest are reported through `truncated`. */
export const MAX_OBSERVED_SERVICES = 12;
/** Services processed at the same time (the Liara client additionally caps in-flight requests at 3). */
export const SERVICE_CONCURRENCY = 3;
export const OBSERVABILITY_TTL_MS = 15_000;
export const OBSERVABILITY_REFRESH_MS = 30_000;
/** Newest releases returned per app (deployment markers). */
export const MAX_RELEASES_PER_APP = 10;
export const MAX_ERROR_LINES_PER_APP = 5;

export interface ObsRelease {
  id: string;
  /** ISO-8601 creation time of the release. */
  at: string;
  /** Raw Liara state (READY, FAILED, ...). */
  state: string;
  tag?: string;
}

export interface ObsServiceDto {
  /** Panel id (see lib/canvas/service-id.ts): app name, or `db:<hostname>`. */
  id: string;
  kind: ServiceKind;
  name: string;
  platformOrEngine: string;
  status: ServiceStatus;
  networkId: string | null;
  planId?: string;
  /** Newest release time (apps only). Absent when unknown. */
  lastReleaseAt?: string;
  /** Newest first. Empty for databases and when the releases call failed (`releasesUnavailable`). */
  releases: ObsRelease[];
  releasesUnavailable?: true;
  /** `{unavailable:true}` when this service's metrics could not be read; other services are unaffected. */
  metrics: MetricsDto | MetricsUnavailableDto;
}

export interface ObservabilityDto {
  range: MetricRange;
  /** Value sent as Liara's `since` (unverified unit [VAL]). */
  since: number;
  generatedAt: string;
  /** false: units and `since` semantics are unverified against a live account [VAL]. */
  unitsVerified: false;
  networks: OverviewNetwork[];
  services: ObsServiceDto[];
  /** `total` counts the services matching the filter; `shown` is how many were queried and returned. */
  truncated: { shown: number; total: number };
}

export interface ObsErrorLine {
  /** ISO-8601 UTC. */
  ts: string;
  stream: "stdout" | "stderr" | "unknown";
  level: LogLevel;
  /** Already redacted server-side. Render as text in a monospace LTR block. */
  message: string;
}

export type ObsErrorsEntry =
  | { id: string; name: string; unavailable: false; lines: ObsErrorLine[]; count: number }
  | { id: string; name: string; unavailable: true };

export interface ObsErrorsDto {
  range: MetricRange;
  generatedAt: string;
  entries: ObsErrorsEntry[];
  /** Apps beyond the cap are not scanned. */
  truncated: { shown: number; total: number };
}
