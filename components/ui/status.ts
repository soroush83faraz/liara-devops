import {
  Activity,
  CircleCheck,
  CircleHelp,
  CirclePause,
  CircleX,
  Hammer,
  HeartCrack,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { t, type TKey } from "../../lib/i18n/t";

/** Generic service states every unit maps its raw Liara/probe state onto. */
export const SERVICE_STATUSES = [
  "running",
  "stopped",
  "building",
  "failed",
  "unhealthy",
  "unknown",
  "healthy",
  "degraded",
] as const;

export type ServiceStatus = (typeof SERVICE_STATUSES)[number];
export type StatusTone = "ok" | "warn" | "danger" | "info" | "neutral";

export interface StatusMeta {
  tone: StatusTone;
  icon: LucideIcon;
  labelKey: TKey;
  /** Icon should spin (in-progress states). */
  busy: boolean;
}

const META: Record<ServiceStatus, StatusMeta> = {
  healthy: { tone: "ok", icon: CircleCheck, labelKey: "status.healthy", busy: false },
  running: { tone: "ok", icon: Activity, labelKey: "status.running", busy: false },
  stopped: { tone: "neutral", icon: CirclePause, labelKey: "status.stopped", busy: false },
  building: { tone: "info", icon: Hammer, labelKey: "status.building", busy: true },
  failed: { tone: "danger", icon: CircleX, labelKey: "status.failed", busy: false },
  unhealthy: { tone: "danger", icon: HeartCrack, labelKey: "status.unhealthy", busy: false },
  degraded: { tone: "warn", icon: TriangleAlert, labelKey: "status.degraded", busy: false },
  unknown: { tone: "neutral", icon: CircleHelp, labelKey: "status.unknown", busy: false },
};

export function statusMeta(status: ServiceStatus): StatusMeta {
  return META[status];
}

const ALIASES: Record<string, ServiceStatus> = {
  up: "running",
  started: "running",
  active: "running",
  ok: "healthy",
  down: "stopped",
  off: "stopped",
  paused: "stopped",
  inactive: "stopped",
  deploying: "building",
  pending: "building",
  starting: "building",
  error: "failed",
  crashed: "failed",
  crashloop: "failed",
  fail: "failed",
  warning: "degraded",
  slow: "degraded",
};

/**
 * Map an arbitrary raw state string (any case) onto our generic states.
 * Anything not recognised is "unknown" - never guessed.
 */
export function normalizeStatus(raw: string | null | undefined): ServiceStatus {
  if (!raw) return "unknown";
  const key = raw.trim().toLowerCase();
  if ((SERVICE_STATUSES as readonly string[]).includes(key)) return key as ServiceStatus;
  return ALIASES[key] ?? "unknown";
}

/**
 * Persian label for a raw Liara state («ACTIVE» -> «در حال اجرا»), or undefined when the state is not one we
 * know: callers then show the raw value inside a <bdi dir="ltr"> code badge instead of guessing.
 */
export function rawStatusLabel(raw: string | null | undefined): string | undefined {
  const status = normalizeStatus(raw);
  if (status === "unknown" && raw?.trim().toLowerCase() !== "unknown") return undefined;
  return t(META[status].labelKey);
}
