// DTOs of GET /api/plans (isomorphic: imported by the route and by the wizards). Everything is optional where Liara
// may omit it; prices are NEVER invented (a plan without a price is returned without hourly/monthly and cannot be picked).

export interface AppPlanDto {
  id: string;
  label: string;
  ramMb?: number;
  cpu?: number;
  diskGb?: number;
  hourlyToman?: number;
  monthlyToman?: number;
  available: boolean;
  region?: string;
}

export interface BundlePlanDto {
  id: string;
  label: string;
  /** Monthly price as displayed by Liara. */
  displayPrice?: number;
}

export interface DbPlanDto {
  id: string;
  /** Engines this plan can host; empty/omitted means Liara did not say (treated as "any"). */
  supports: string[];
  ramMb?: number;
  cpu?: number;
  volumeGb?: number;
  hourlyToman?: number;
  monthlyToman?: number;
  available: boolean;
}

export interface DbVersionDto {
  label: string;
  value: string;
}

export interface NetworkDto {
  id: string;
  name: string;
}

export interface PlansResponse {
  appPlans: AppPlanDto[];
  bundlePlans: Record<string, BundlePlanDto[]>;
  dbPlans: DbPlanDto[];
  dbBundlePlans: Record<string, BundlePlanDto[]>;
  dbVersions: Record<string, DbVersionDto[]>;
  defaultDbVersions: Record<string, string>;
  platforms: string[];
  networks: NetworkDto[];
  balanceToman?: number;
  /** Team mode: the balance could not be read for this team (no billed create is possible; say so). */
  balanceUnreadable?: boolean;
  flags: { privateNetworkFeature?: boolean; legacyNetworkFeature?: boolean };
  /** True when plans were hidden by the CLI-like filter (unavailable / other region / legacy). */
  filtered: { apps: boolean; dbs: boolean };
  /** Parts that could not be loaded; the UI says so instead of pretending. */
  partial: Array<"balance" | "networks">;
  generatedAt: string;
}
