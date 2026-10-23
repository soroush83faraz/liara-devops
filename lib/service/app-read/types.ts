// DTOs shared by the app-read API routes and the tabs (no server-only imports here).
import type { InjectionReason } from "../../security/injection";

export type LogLevel = "error" | "warn" | "info" | "debug" | "unknown";
export const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug", "unknown"];

export interface LogLineDto {
  /** ISO-8601 UTC (epoch when the source carried no timestamp). */
  ts: string;
  /** Unix nanoseconds as a decimal string; use with stream+message as a de-duplication key. */
  tsNs: string;
  stream: "stdout" | "stderr" | "unknown";
  /** Already passed through server-side secret masking. Render as text only. */
  message: string;
  level: LogLevel;
  /** True when the line looks like instructions aimed at an AI assistant (server-side heuristic; the text itself is unchanged). */
  flagged: boolean;
  /** Short reason code of the first match (lib/security/injection), only when `flagged`. */
  flagReason?: InjectionReason;
  releaseId?: string;
}

/** Unavailable pieces never carry data: the UI shows «داده در دسترس نیست». */
export type Section<T> = { unavailable: false; data: T } | { unavailable: true };

export interface GitInfoDto {
  branch?: string;
  commit?: string;
  message?: string;
  committedAt?: string;
  author?: string;
  remote?: string;
}

export interface ReleaseDto {
  id: string;
  tag?: string;
  /** Raw Liara state: READY, FAILED, CANCELED, TIMEDOUT, UNHEALTHY, DEPLOYING, ... */
  state: string;
  failReason?: string;
  queue?: number;
  port?: number;
  type?: string;
  gitInfo?: GitInfoDto;
  createdAt?: string;
  finishedAt?: string;
  durationMs?: number;
  isCurrent: boolean;
  /** True while the build/deploy is still in progress (the log viewer should stream). */
  live: boolean;
}

export interface ReleasesPageDto {
  total: number;
  page: number;
  count: number;
  currentRelease?: string;
  releases: ReleaseDto[];
}

export interface AppletDto {
  id?: string;
  name?: string;
  state?: string;
  reason?: string;
  since?: string;
  releaseId?: string;
  releaseTag?: string;
}

export interface EventDto {
  ts: string;
  message: string;
  level: LogLevel;
}

export interface UsageValue {
  applet?: string;
  value: number;
}

export interface UsageDto {
  /** Units are unverified against a live account [VAL]. */
  cpu: UsageValue[];
  memory: UsageValue[];
  disks: Array<{ name?: string; size?: number; usage?: number; reportedAt?: string }>;
}

export interface AppOverviewDto {
  app: {
    name: string;
    platform?: string;
    status?: string;
    scale?: number;
    isDeployed?: boolean;
    planID?: string;
    bundlePlanID?: string;
    hourlyPrice?: number;
    createdAt?: string;
    network?: { id?: string; name?: string };
    /** `https://<name>.liara.run` when the default subdomain is enabled [VAL]. */
    url?: string;
    defaultSubdomain?: boolean;
    zeroDowntime?: boolean;
    readOnlyRootFilesystem?: boolean;
    fixedIPStatus?: string;
    nodeIp?: string;
    reservedDiskSpace?: number;
  };
  applets: Section<AppletDto[]>;
  latestRelease: Section<ReleaseDto | null>;
  events: Section<EventDto[]>;
  usage: Section<UsageDto>;
}

// ---- Metrics ---------------------------------------------------------------
export type MetricRange = "15m" | "1h" | "6h" | "24h";

export interface MetricSeriesDto {
  applet?: string;
  /** t = unix seconds. */
  points: Array<{ t: number; v: number }>;
}
export type MetricSeriesSection = { unavailable: false; series: MetricSeriesDto[] } | { unavailable: true };

export interface MetricsDto {
  unavailable?: false;
  range: MetricRange;
  /** Value sent as Liara's `since` (unix seconds assumed [VAL]). */
  since: number;
  /** false: units/`since` semantics are unverified against a live account [VAL]. */
  unitsVerified: false;
  cpu: MetricSeriesSection;
  memory: MetricSeriesSection;
  networkRx: MetricSeriesSection;
  networkTx: MetricSeriesSection;
  /** Plan limits when known (from /v1/me plans); RAM in GB as reported [VAL]. */
  limits?: { ramGb?: number; cpu?: number };
  current?: UsageDto;
}
export interface MetricsUnavailableDto {
  unavailable: true;
  reason: "request_failed" | "empty";
  range: MetricRange;
}

// ---- Streams ---------------------------------------------------------------
/** SSE `data:` payloads of `GET /api/releases/{id}/stream` (default `message` event). */
export type ReleaseStreamEvent =
  | { kind: "state"; state: string; queue?: number }
  | { kind: "log"; stream: "STDOUT" | "STDERR"; line: string; createdAt?: string }
  | { kind: "done"; state: string; ok: boolean; failReason?: string; reason?: string }
  | StreamErrorEvent;

/** SSE `data:` payloads of `GET /api/apps/{name}/logs/stream`. */
export type LogStreamEvent =
  | { kind: "open"; sinceSec: number }
  | { kind: "line"; line: LogLineDto }
  | { kind: "end"; reason: "max_duration" }
  | StreamErrorEvent;

/** `fatal: true` means the client must not auto-reconnect (e.g. concurrency cap). */
export interface StreamErrorEvent {
  kind: "error";
  code: string;
  message: string;
  fatal?: boolean;
}

/** Props of every app tab component (stable contract with the service panel). */
export type AppPanelProps = { name: string };
