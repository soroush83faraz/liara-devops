// DTOs shared by the db API routes and the tabs. None of them can carry a password.
import type { ServiceStatus } from "../../../components/ui/status";

export interface DbPlanFacts {
  ramGb?: number;
  cpu?: number;
  diskGb?: number;
  /** Omitted when Liara gave no price for the plan (never 0). */
  pricePerMonth?: number;
}

export interface DbOverviewDto {
  hostname: string;
  engine: string;
  version?: string;
  planID?: string;
  bundlePlanID?: string;
  /** Raw Liara status string (enum partly unknown [VAL]). */
  status?: string;
  uiStatus: ServiceStatus;
  scale?: number;
  /** Unit assumed to be GB [VAL]. */
  volumeSizeGb?: number;
  hourlyPrice?: number;
  createdAt?: string;
  publicNetwork: boolean;
  internalPort?: number;
  network: { id?: string; name?: string } | null;
  standaloneReplicaSet?: boolean;
  plan?: DbPlanFacts;
}

export interface BackupDto {
  name: string;
  /** Unit assumed to be bytes [VAL]. */
  size?: number;
  lastModified?: string;
}

export interface DbBackupsDto {
  backups: BackupDto[];
}

export interface DbPlansDto {
  currentPlanID?: string;
  engine: string;
  plans: import("./plans").PlanOptionDto[];
}
