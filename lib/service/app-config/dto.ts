// DTOs shared by the config routes and tabs (no server-only imports; safe for client bundles).
import type { Section } from "@/lib/service/app-read/types";

export type { Section };

/** Env list entry. Never carries the value: use the reveal route for a single value. */
export interface MaskedEnvDto {
  key: string;
  masked: true;
  encrypted: boolean;
  /** Length of the stored value, so the UI can show a masked placeholder of a sensible size. */
  valueLength?: number;
}
export interface EnvListDto {
  envs: MaskedEnvDto[];
}
export interface RevealEnvDto {
  ok: true;
  value: string;
}

export type DnsRecordKind = "cname" | "verification" | "acme";
export interface DnsRecordDto {
  kind: DnsRecordKind;
  /** Exactly what Liara returned, or null when Liara returned nothing for it. */
  value: string | null;
  /** Name of the response field the value came from (shown for unverified formats). */
  sourceKey?: string;
}

export interface DomainDto {
  id: string;
  name: string;
  punycodeName?: string;
  /** Raw Liara strings; enums are unverified [VAL]. */
  status?: string;
  certificatesStatus?: string;
  redirectTo?: string;
  redirectStatus?: number;
  createdAt?: string;
  records: DnsRecordDto[];
}
export interface DomainsListDto {
  domains: DomainDto[];
}
export interface DomainAddedDto {
  ok: true;
  id?: string;
  /** Present when the follow-up `check` succeeded (carries the records to configure). */
  domain?: DomainDto;
}
export interface DomainCheckDto {
  checkedAt: string;
  domain: DomainDto;
}

export interface DiskDto {
  id?: string;
  name: string;
  sizeGb?: number;
  mountedTo?: string;
  createdAt?: string;
}
export interface DisksDto {
  disks: DiskDto[];
  /** Reserved disk space from the app detail (unit as reported by Liara). */
  reservedDiskSpace?: number;
}

export interface PlanOption {
  id: string;
  ramGb?: number;
  cpu?: number;
  /** False when Liara gave no price: the numbers are omitted (never 0) and the UI shows «قیمت نامشخص». */
  priceKnown: boolean;
  pricePerHour?: number;
  pricePerMonth?: number;
  available: boolean;
}

export interface SettingsDto {
  name: string;
  status?: string;
  /** 0 = stopped, 1 = running. */
  scale?: number;
  isDeployed?: boolean;
  planID?: string;
  bundlePlanID?: string;
  hourlyPrice?: number;
  /** Best effort: app detail, else the latest release. Unknown otherwise. */
  port?: number;
  defaultSubdomain?: boolean;
  zeroDowntime?: boolean;
  readOnlyRootFilesystem?: boolean;
  fixedIPStatus?: string;
  nodeIp?: string;
  reservedDiskSpace?: number;
  plans: Section<PlanOption[]>;
}

export const APP_TOGGLES = ["zero-downtime", "default-subdomain", "fixed-ip", "read-only"] as const;
export type AppToggleId = (typeof APP_TOGGLES)[number];
