// Shared synthetic samples for contract and security tests (not a test file).
import { ACTION_POLICY, actionTarget, type ActionParams, type ActionParamsOf, type ActionType } from "../../../lib/contracts/action";
import { costFromHourly } from "../../../lib/contracts/common";
import { sampleDeployPlan } from "../../../lib/contracts/fixtures";
import type { Proposal } from "../../../lib/contracts/proposal";

export const SAMPLE_PARAMS: { [K in ActionType]: ActionParamsOf<K> } = {
  restart: { type: "restart", app: "shop" },
  set_env: {
    type: "set_env",
    app: "shop",
    changes: [
      { op: "set", key: "SESSION_SECRET", valueSource: "generated", generator: "hex32" },
      { op: "set", key: "API_TOKEN", valueSource: "user" },
      { op: "set", key: "DB_PASSWORD", valueSource: "existing", from: { kind: "db", name: "shop-db", field: "password" } },
      { op: "set", key: "DATABASE_URL", valueSource: "existing", from: { kind: "app_env", key: "DB_URL" } },
      { op: "unset", key: "OLD_KEY" },
    ],
  },
  unset_env: { type: "unset_env", app: "shop", keys: ["OLD_KEY"] },
  scale: { type: "scale", resource: { kind: "db", name: "shop-db" }, scale: 1 },
  update_port: { type: "update_port", app: "shop", port: 8080 },
  resize: { type: "resize", resource: { kind: "app", name: "shop" }, planId: "standard-g2" },
  redeploy_previous: { type: "redeploy_previous", app: "shop", releaseId: "rel_0001" },
  wire_db: { type: "wire_db", app: "shop", db: "shop-db", mapping: { host: "DB_HOST", password: "DB_PASSWORD" } },
  deploy_plan: { type: "deploy_plan", plan: sampleDeployPlan },
  create_app: { type: "create_app", name: "shop", platform: "node", planId: "standard-g2" },
  create_db: { type: "create_db", name: "shop-db", engine: "postgres", version: "16", planId: "db-small-g2", publicNetwork: false },
  create_network: { type: "create_network", name: "shop-net" },
  delete_app: { type: "delete_app", app: "shop" },
  delete_db: { type: "delete_db", db: "shop-db" },
  delete_domain: { type: "delete_domain", domain: "shop.example.ir" },
  delete_disk: { type: "delete_disk", app: "shop", disk: "uploads" },
};

export const ALL_SAMPLE_PARAMS: ActionParams[] = Object.values(SAMPLE_PARAMS);

export const HEX64 = "a".repeat(64);
export const T_CREATED = "2026-10-22T08:00:00.000Z";
export const T_EXPIRES = "2026-10-22T08:10:00.000Z";

/** A schema-valid proposal for `params` (paramsHash is a placeholder; schemas cannot check it). */
export function makeProposal(params: ActionParams = SAMPLE_PARAMS.restart, overrides: Partial<Proposal> = {}): Proposal {
  const policy = ACTION_POLICY[params.type];
  return {
    id: `p_test_${params.type}`,
    status: "proposed",
    type: params.type,
    target: actionTarget(params),
    params,
    rationaleFa: "دلیل آزمایشی",
    evidenceIds: policy.aiProposable ? ["O1"] : [],
    effectFa: "اثر آزمایشی",
    risksFa: [],
    reversible: policy.reversible,
    costEstimate: policy.billed ? costFromHourly(1000) : undefined,
    verificationPlan: ["check"],
    createdAt: T_CREATED,
    expiresAt: T_EXPIRES,
    source: policy.aiProposable ? "agent" : "user",
    paramsHash: HEX64,
    idempotencyKey: "idk_test",
    stateFingerprint: HEX64,
    ...overrides,
  };
}

/** Deterministic PRNG for property-style loops. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random string over the code points of `alphabet` (never splits surrogate pairs). */
export function randomString(rand: () => number, alphabet: string, min: number, max: number): string {
  const chars = [...alphabet];
  const len = min + Math.floor(rand() * (max - min + 1));
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

export const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
