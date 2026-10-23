// Shared types of the evidence engine. Pure data: no IO, no LLM.
import type { Observation, ObservationKind, ObservationSource, Severity } from "@/lib/contracts/observation";
import type { UnknownItem } from "@/lib/contracts/hypothesis";
import type { ProbeResult } from "@/lib/canvas/types";
import type { AppLifecycleEvent } from "@/lib/liara/events";

/** An observation before `assignIds` gives it its `O<n>` id. */
export type DraftObservation = Omit<Observation, "id">;
export type ObservationParams = Observation["params"];
export type { Observation, ObservationKind, ObservationSource, Severity };

/* ---------------------------------------------------------------- sources */

export const APP_SOURCES = [
  "app",
  "applets",
  "releases",
  "release_detail",
  "build_logs",
  "events",
  "runtime_logs",
  "metrics_summary",
  "metrics_series",
  "probe",
  "plan",
  "databases",
  "db_detail",
] as const;
export const DB_SOURCES = ["db_list", "db_detail", "db_metrics", "db_events"] as const;
export type SourceName = (typeof APP_SOURCES)[number] | (typeof DB_SOURCES)[number];

export type SourceState = "ok" | "failed" | "unavailable";

/** One PASS-1 read. `error` is a stable code (never an upstream message). */
export interface SourceStatus {
  source: SourceName;
  status: SourceState;
  error?: string;
  /** Items returned (lines, releases...), when meaningful. */
  count?: number;
}

/** Error code used when a source was intentionally not read (e.g. build logs of a READY release). */
export const NOT_APPLICABLE = "not_applicable";

/* --------------------------------------------------------------- unknowns */

/** An explicit gap in the evidence: what is missing and how to get it. Maps onto the contract `UnknownItem`. */
export interface EvidenceUnknown extends UnknownItem {
  code: string;
  source?: SourceName;
}

/* --------------------------------------------------------------- timeline */

export type TimelineKind =
  | "release_created"
  | "release_finished"
  | "env_change"
  | "restart"
  | "first_error"
  | "error_onset"
  | "oom_kill"
  | "probe";

export interface TimelineEvent {
  ts: string;
  kind: TimelineKind;
  /** i18n-style code. */
  label: string;
  ref?: string;
  params?: Record<string, string | number>;
}

/** A change that can explain an onset (plan §4: release/config change). */
export interface ChangeEvent {
  ts: string;
  kind: "release" | "env_change" | "restart";
  releaseTag?: string;
  releaseId?: string;
  /** Release state (upper case) for release changes. */
  state?: string;
}

export interface Correlation {
  withReleaseTag?: string;
  changeKind?: ChangeEvent["kind"];
  changeTs?: string;
  onsetTs?: string;
  /** onset - change, seconds (negative = onset slightly before the change). */
  deltaSec: number;
  within5min: boolean;
}

/* ----------------------------------------------------------- normalized */

export interface EvidenceLine {
  /** ISO time; absent when the source line had no timestamp. */
  ts?: string;
  ms?: number;
  stream: "stdout" | "stderr" | "unknown";
  /** Redacted, cleaned text. */
  message: string;
  releaseId?: string;
}

/** Repeated lines collapsed by normalised signature. */
export interface LogGroup {
  /** Normalised text (numbers/ids/timestamps replaced). */
  pattern: string;
  /** First redacted occurrence. */
  message: string;
  count: number;
  firstTs?: string;
  lastTs?: string;
  firstMs?: number;
  lastMs?: number;
  /** Index of the first occurrence in the line array (for multi-line context). */
  firstIndex: number;
  stream: EvidenceLine["stream"];
  /** Release of the lines in this group (groups never mix releases). */
  releaseId?: string;
}

export interface AppFacts {
  name: string;
  platform?: string;
  status?: string;
  scale?: number;
  planId?: string;
  /** Port the app is configured to listen on (current release `port`, else app detail) [VAL]. */
  configuredPort?: number;
  /** Env variable KEY names only. Values are never kept. */
  envKeys: string[];
  networkId?: string;
  networkName?: string;
}

export interface AppletFacts {
  name?: string;
  state?: string;
  reason?: string;
  timestamp?: string;
  releaseTag?: string;
}

export interface ReleaseFacts {
  id?: string;
  tag?: string;
  state?: string;
  createdAt?: string;
  finishedAt?: string;
  failReason?: string;
  port?: number;
}

export interface MetricFacts {
  /** Latest CPU usage in cores (of the applet serving now when known, else max over applets) [VAL unit]. */
  cpuCores?: number;
  /** Latest memory usage in bytes (max over applets) [VAL unit]. */
  memBytes?: number;
  /** CPU series of the applet serving now (newest last sample; see `pickCurrentApplet` in facts.ts). */
  cpuSeries?: Array<{ t: number; v: number }>;
  /** Every applet's CPU series, only when there is more than one (rolling restart); used for the pre-release baseline. */
  cpuApplets?: Array<{ applet?: string; points: Array<{ t: number; v: number }> }>;
  memSeries?: Array<{ t: number; v: number }>;
}

export interface PlanLimits {
  cpu?: number;
  ramGb?: number;
}

export interface DbFacts {
  hostname: string;
  id?: string;
  engine?: string;
  status?: string;
  scale?: number;
  publicNetwork?: boolean;
  networkId?: string;
  networkName?: string;
  port?: number;
  internalPort?: number;
}

/** App that references a database (env KEY name only, as derived by the overview). */
export interface DbAppRef {
  app: string;
  envKey: string;
  networkId?: string | null;
  /** Which host form the app's variable points to, when the caller knows it (never the value). */
  hostKind?: "private" | "public" | "unknown";
}

/** Everything the pure extractors see. Built by `analyze*` from redacted reads. */
export interface ExtractContext {
  now: number;
  windowMin: number;
  app?: AppFacts;
  plan?: PlanLimits;
  logs: EvidenceLine[];
  logGroups: LogGroup[];
  buildLines: EvidenceLine[];
  buildGroups: LogGroup[];
  events: EvidenceLine[];
  eventGroups: LogGroup[];
  /** Structured container lifecycle events (ascending, live shape 2026-10-23); absent when not read. */
  lifecycle?: AppLifecycleEvent[];
  applets: AppletFacts[];
  /** False when the applets were NOT read (call failed or skipped): an empty list then means "unknown", not "none". Default: known. */
  appletsKnown?: boolean;
  /** Newest first. */
  releases: ReleaseFacts[];
  currentReleaseId?: string;
  /**
   * Releases whose runtime output describes the app's present state: the serving release and releases newer
   * than it. Lifecycle-derived signals (crash loops) only count for these. Absent = no release scoping.
   */
  liveReleaseIds?: readonly string[];
  metrics?: MetricFacts;
  probe?: ProbeResult;
  /** DBs relevant to this investigation (app mode) or the target DB (db mode, first). */
  dbs: DbFacts[];
  dbApps?: DbAppRef[];
  mode: "app" | "db";
}

export type Extractor = (ctx: ExtractContext) => DraftObservation[];

/* ----------------------------------------------------------------- bundle */

export interface EvidenceBundle {
  target: { kind: "app" | "db"; name: string };
  collectedAt: string;
  windowMin: number;
  sources: SourceStatus[];
  /** Redacted structured data (no env values, no passwords). */
  raw: Record<string, unknown>;
  observations: Observation[];
  timeline: TimelineEvent[];
  correlation?: Correlation;
  unknowns: EvidenceUnknown[];
  /** Persian limitation notes (fit `Finding.limitsNote`). */
  limits: string[];
}
