// SYNTHETIC inputs: hand-written to exercise the code, NOT recorded from Liara.
import { MeSchema } from "@/lib/liara/schemas";
import type { PlansResponse } from "@/lib/create/types";
import { normalizePlans } from "@/lib/create/plans";

export const rawMe = {
  user: { _id: "u1", fullname: "x", email: "x@example.invalid", isTeam: false, privateNetworkFeature: true, legacyNetworkFeature: false },
  databaseVersions: {
    postgres: [{ label: "16", value: "16" }, { label: "15", value: "15" }],
    redis: [{ label: "7", value: "7" }],
    mysql: [],
    bogus: "nope",
  },
  defaultDatabaseVersions: { postgres: "15", redis: { value: "9" } },
  plans: {
    projects: {
      free: { available: true, region: "iran", RAM: { amount: 0.25 }, CPU: { amount: 0.25 }, volume: 1, price: 0 },
      "iran-g2-small": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5, price: 100 },
      "iran-g2-nopice": { available: true, region: "iran", RAM: 2, CPU: 1 },
      "germany-g2-small": { available: true, region: "germany", price: 90 },
      "old-plan": { available: true, region: "iran", price: 50 },
      "iran-g2-big": { available: false, region: "iran", price: 800 },
      broken: "not-an-object",
    },
    projectBundlePlans: {
      "iran-g2-small": {
        standard: { available: true, displayPrice: 50000 },
        pro: { available: true, displayPrice: 120000 },
        off: { available: false, displayPrice: 1 },
      },
    },
    databases: {
      "iran-g2-small": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 10, price: 0.5, supports: ["postgres", "mysql"] },
      "iran-g2-redis": { available: true, RAM: { amount: 0.5 }, price: 0.25, supports: ["redis"] },
      "iran-g2-any": { available: true, price: 2 },
    },
    databaseBundlePlans: { "iran-g2-small": { standard: { available: true, displayPrice: 10000 } } },
  },
};

export const me = () => MeSchema.parse(rawMe);

export const samplePlans = (over: Partial<PlansResponse> = {}): PlansResponse => ({
  ...normalizePlans({
    me: me(),
    balanceToman: 5000,
    networks: [{ id: "n1", name: "main" }],
    now: new Date("2026-01-01T00:00:00Z"),
  }),
  ...over,
});
