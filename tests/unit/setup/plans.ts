import type { DbVersions, NormalizedPlan } from "@/lib/liara/account";

export const plan = (id: string, ramGb: number, cpu: number, pricePerHour: number, extra: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  id,
  available: true,
  region: "iran",
  ramGb,
  cpu,
  diskGb: 5,
  pricePerHour,
  pricePerMonth: Math.round(pricePerHour * 720 * 100) / 100,
  priceKnown: pricePerHour > 0,
  legacy: false,
  bundles: [],
  ...extra,
});

/** Synthetic price ladder, NOT Liara's real prices. */
export const APP_PLANS: NormalizedPlan[] = [
  plan("small-g2", 0.5, 0.5, 1000),
  plan("medium-g2", 1, 1, 2000, { bundles: [{ id: "standard", available: true, monthlyPrice: 36000 }, { id: "pro", available: false, monthlyPrice: 90000 }] }),
  plan("large-g2", 2, 1, 4000),
  plan("xlarge-g2", 4, 2, 8000),
  plan("down-g2", 8, 4, 16000, { available: false }),
];

export const DB_PLANS: NormalizedPlan[] = [
  plan("db-small-g2", 0.5, 0.5, 600, { supports: ["postgres", "mysql", "mariadb", "mongodb", "redis"] }),
  plan("db-medium-g2", 2, 1, 2400, { supports: ["postgres", "mysql", "mssql", "mongodb"] }),
];

export const DB_VERSIONS: DbVersions[] = [
  { engine: "postgres", versions: [{ label: "16", value: "16" }], defaultVersion: "16" },
  { engine: "mysql", versions: [{ label: "8", value: "8.0" }, { label: "5.7", value: "5.7" }] },
  { engine: "redis", versions: [{ label: "7", value: "7" }] },
  { engine: "mssql", versions: [{ label: "2022", value: "2022" }] },
];

export const NETWORKS = [{ _id: "net1", name: "main-net" }];
export const SOURCES = { appPlans: APP_PLANS, dbPlans: DB_PLANS, dbVersions: DB_VERSIONS };
