// Wire types shared by the overview/probe routes and the canvas UI. No secrets live here:
// no env values, no database passwords, no tokens.
import type { ServiceStatus } from "@/components/ui/status";

export type ServiceKind = "app" | "db";

export interface OverviewNetwork {
  id: string;
  name: string;
}

export interface OverviewService {
  /** Stable panel id: the app name for apps, `db:<hostname>` for databases (see service-id.ts). */
  id: string;
  kind: ServiceKind;
  name: string;
  /** Liara-side id used in /v1/databases/{id} paths (databases only). */
  ref?: string;
  networkId: string | null;
  /** App platform (`node`, `next`...) or database engine (`postgres`...). */
  platformOrEngine: string;
  status: ServiceStatus;
  /** Raw Liara status string, for display in tooltips only. */
  rawStatus?: string;
  planId?: string;
  hourlyPriceToman?: number;
  createdAt?: string;
  lastDeployAt?: string;
  url?: string;
  /** Informational only. The probe route never accepts a URL from the client. */
  healthUrl?: string;
}

export interface OverviewEdge {
  /** Service id of the app that holds the variable. */
  from: string;
  /** Service id of the database. */
  to: string;
  /** Env variable KEY name only. */
  viaKey: string;
}

export interface Overview {
  networks: OverviewNetwork[];
  services: OverviewService[];
  edges: OverviewEdge[];
  /** True when not every app could be inspected (cap, or a detail call failed). */
  edgesPartial?: boolean;
  /** Toman of the wallet that pays: the team's in team mode, the person's otherwise. Absent = unknown. */
  balance?: number;
  balanceSource?: "team" | "user";
  /** True in team mode when Liara returned no usable team balance (the personal one is never shown instead). */
  balanceUnreadable?: boolean;
  errors: { databases?: string; networks?: string; billing?: string };
  generatedAt: string;
}

export type ProbeErrorCode =
  | "timeout"
  | "dns"
  | "refused"
  | "tls"
  | "network"
  | "no_url"
  | "blocked_address"
  | "too_many_redirects"
  | "rate_limited"
  | "unknown";

export interface ProbeResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  /** ISO timestamp. */
  checkedAt: string;
  error?: ProbeErrorCode;
}
