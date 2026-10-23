import { describe, expect, it } from "vitest";
import {
  ACTION_PARAMS_SCHEMAS,
  ACTION_POLICY,
  ACTION_TYPES,
  AI_PROPOSABLE_ACTION_TYPES,
  ActionParamsSchema,
  ActionTypeSchema,
  AiProposableActionParamsSchema,
  actionTarget,
  isActionType,
  userValueKeys,
  type ActionType,
} from "../../../lib/contracts/action";
import {
  EnvChangeListSchema,
  EnvChangeSchema,
  EnvKeySchema,
  UserEnvValuesSchema,
  WireMappingSchema,
  checkUserEnvValues,
} from "../../../lib/contracts/env";
import { ALL_SAMPLE_PARAMS, SAMPLE_PARAMS } from "./samples";

const PLAN_AI_TYPES = [
  "restart",
  "set_env",
  "unset_env",
  "scale",
  "update_port",
  "resize",
  "redeploy_previous",
  "wire_db",
  "deploy_plan",
];

describe("ACTION_POLICY invariants", () => {
  it("covers exactly the 16 action types", () => {
    expect(new Set(ACTION_TYPES).size).toBe(16);
    expect(Object.keys(ACTION_POLICY).sort()).toEqual([...ACTION_TYPES].sort());
  });

  it("every tier-3 action is a delete, human-only, typed-name, irreversible", () => {
    for (const t of ACTION_TYPES) {
      const p = ACTION_POLICY[t];
      if (p.tier === 3) {
        expect(t.startsWith("delete_"), t).toBe(true);
        expect(p.aiProposable, t).toBe(false);
        expect(p.requiresTypedName, t).toBe(true);
        expect(p.reversible, t).toBe("no");
      }
      if (t.startsWith("delete_")) expect(p.tier, t).toBe(3);
    }
  });

  it("every aiProposable action has a tier of 1 or 2", () => {
    for (const t of ACTION_TYPES) {
      if (ACTION_POLICY[t].aiProposable) expect([1, 2], t).toContain(ACTION_POLICY[t].tier);
    }
  });

  it("billed actions are tier 2; tier 2 needs a typed name; tier 1 needs neither", () => {
    for (const t of ACTION_TYPES) {
      const p = ACTION_POLICY[t];
      if (p.billed) expect(p.tier, t).toBe(2);
      if (p.tier === 2) expect(p.requiresTypedName, t).toBe(true);
      if (p.tier === 1) {
        expect(p.requiresTypedName, t).toBe(false);
        expect(p.billed, t).toBe(false);
      }
      expect(p.tier, t).not.toBe(0);
    }
  });

  it("the assistant can propose exactly the plan's propose_action types", () => {
    expect([...AI_PROPOSABLE_ACTION_TYPES].sort()).toEqual([...PLAN_AI_TYPES].sort());
    for (const t of ["create_app", "create_db", "create_network"] as ActionType[]) {
      expect(ACTION_POLICY[t].aiProposable).toBe(false);
    }
  });

  it("is frozen at table and row level", () => {
    expect(Object.isFrozen(ACTION_POLICY)).toBe(true);
    expect(Object.isFrozen(AI_PROPOSABLE_ACTION_TYPES)).toBe(true);
    for (const t of ACTION_TYPES) expect(Object.isFrozen(ACTION_POLICY[t])).toBe(true);
    expect(() => {
      (ACTION_POLICY.delete_app as { aiProposable: boolean }).aiProposable = true;
    }).toThrow(TypeError);
    expect(ACTION_POLICY.delete_app.aiProposable).toBe(false);
  });
});

describe("action types and params", () => {
  it("rejects unknown or look-alike action types", () => {
    for (const bad of ["drop_everything", "DELETE_APP", "restart ", " restart", "shell", "", "__proto__", "constructor", "toString", 1, null]) {
      expect(ActionTypeSchema.safeParse(bad).success, String(bad)).toBe(false);
      expect(isActionType(bad), String(bad)).toBe(false);
    }
    expect(ActionParamsSchema.safeParse({ type: "shell", cmd: "rm -rf /" }).success).toBe(false);
    expect(ActionParamsSchema.safeParse({ type: "exec", app: "shop" }).success).toBe(false);
  });

  it("every type has a params schema and a valid sample", () => {
    for (const t of ACTION_TYPES) {
      expect(ACTION_PARAMS_SCHEMAS[t].safeParse(SAMPLE_PARAMS[t]).success, t).toBe(true);
      expect(ActionParamsSchema.safeParse(SAMPLE_PARAMS[t]).success, t).toBe(true);
    }
  });

  it("rejects unknown fields and wrong discriminators in params", () => {
    expect(ActionParamsSchema.safeParse({ ...SAMPLE_PARAMS.restart, force: true }).success).toBe(false);
    expect(ActionParamsSchema.safeParse({ ...SAMPLE_PARAMS.delete_disk, type: "delete_app" }).success).toBe(false);
    expect(ActionParamsSchema.safeParse({ type: "scale", resource: { kind: "app", name: "shop" }, scale: 2 }).success).toBe(false);
    expect(ActionParamsSchema.safeParse({ type: "update_port", app: "shop", port: 70000 }).success).toBe(false);
  });

  it("rejects resource names that could inject into Liara URL paths", () => {
    for (const name of ["../shop", "shop/../../v1", "shop?x=1", "shop#x", "%2e%2e", "Shop", "sh op", "shop\n", "شاپ", "-shop", "a".repeat(64), ""]) {
      expect(ActionParamsSchema.safeParse({ type: "restart", app: name }).success, JSON.stringify(name)).toBe(false);
    }
    for (const domain of ["evil.com/../x", "EXAMPLE.ir", "example.ir.", "*.example.ir", "localhost", "a".repeat(300) + ".ir"]) {
      expect(ActionParamsSchema.safeParse({ type: "delete_domain", domain }).success, domain).toBe(false);
    }
    expect(ActionParamsSchema.safeParse({ type: "delete_domain", domain: "xn--mgbh0fb.xn--mgba3a4f16a" }).success).toBe(true);
  });

  it("the AI schema accepts only aiProposable types", () => {
    for (const p of ALL_SAMPLE_PARAMS) {
      expect(AiProposableActionParamsSchema.safeParse(p).success, p.type).toBe(ACTION_POLICY[p.type].aiProposable);
    }
  });

  it("derives targets from params", () => {
    expect(actionTarget(SAMPLE_PARAMS.restart)).toEqual({ kind: "app", name: "shop" });
    expect(actionTarget(SAMPLE_PARAMS.scale)).toEqual({ kind: "db", name: "shop-db" });
    expect(actionTarget(SAMPLE_PARAMS.resize)).toEqual({ kind: "app", name: "shop" });
    expect(actionTarget(SAMPLE_PARAMS.deploy_plan)).toEqual({ kind: "app", name: "blog-demo" });
    expect(actionTarget(SAMPLE_PARAMS.create_db)).toEqual({ kind: "db", name: "shop-db" });
    expect(actionTarget(SAMPLE_PARAMS.create_network)).toEqual({ kind: "network", name: "shop-net" });
    expect(actionTarget(SAMPLE_PARAMS.delete_domain)).toEqual({ kind: "domain", name: "shop.example.ir" });
    expect(actionTarget(SAMPLE_PARAMS.delete_disk)).toEqual({ kind: "disk", name: "uploads" });
  });
});

describe("env changes never carry values", () => {
  const leaking: unknown[] = [
    { op: "set", key: "A", valueSource: "user", value: "leak" },
    { op: "set", key: "A", value: "leak" },
    { op: "set", key: "A", valueSource: "generated", generator: "hex32", value: "leak" },
    { op: "set", key: "A", valueSource: "existing", from: { kind: "db", name: "d", field: "password", value: "leak" } },
    { op: "set", key: "A", valueSource: "existing", from: { kind: "app_env", key: "B" }, value: "leak" },
    { op: "set", key: "A", valueSource: "literal", literal: "leak" },
    { op: "set", key: "A", valueSource: "user", valueRef: { value: "leak" } },
    { op: "unset", key: "A", value: "leak" },
    { op: "set", key: "A", valueSource: "generated", generator: "attacker-chosen" },
    { op: "set", key: "A", valueSource: "existing", from: { kind: "url", url: "https://evil.example" } },
  ];

  it("rejects every change shape that could hold a value", () => {
    for (const change of leaking) expect(EnvChangeSchema.safeParse(change).success, JSON.stringify(change)).toBe(false);
  });

  it("never copies existing secrets into browser-exposed keys", () => {
    for (const key of ["NEXT_PUBLIC_DB_PASSWORD", "VITE_TOKEN", "REACT_APP_X", "next_public_lower", "PUBLIC_SECRET"]) {
      expect(
        EnvChangeSchema.safeParse({ op: "set", key, valueSource: "existing", from: { kind: "db", name: "shop-db", field: "password" } }).success,
        key,
      ).toBe(false);
      expect(EnvChangeSchema.safeParse({ op: "set", key, valueSource: "existing", from: { kind: "app_env", key: "DB_PASSWORD" } }).success, key).toBe(false);
      expect(WireMappingSchema.safeParse({ password: key }).success, key).toBe(false);
      // generated or user-typed values are the user's explicit choice
      expect(EnvChangeSchema.safeParse({ op: "set", key, valueSource: "user" }).success, key).toBe(true);
    }
    expect(EnvChangeSchema.safeParse({ op: "set", key: "PUBLICATION_ID", valueSource: "existing", from: { kind: "app_env", key: "X" } }).success).toBe(true);
  });

  it("rejects values smuggled at the params or plan level", () => {
    expect(ActionParamsSchema.safeParse({ ...SAMPLE_PARAMS.set_env, values: { API_TOKEN: "leak" } }).success).toBe(false);
    const plan = structuredClone(SAMPLE_PARAMS.deploy_plan);
    const step = plan.plan.steps.find((s) => s.kind === "set_env");
    expect(step).toBeDefined();
    (step as unknown as { changes: unknown[] }).changes.push({ op: "set", key: "LEAK", valueSource: "user", value: "x" });
    expect(ActionParamsSchema.safeParse(plan).success).toBe(false);
  });

  it("valid params contain no value-bearing field anywhere", () => {
    const json = JSON.stringify(ALL_SAMPLE_PARAMS);
    expect(json).not.toMatch(/"value"\s*:/);
  });

  it("rejects duplicate keys, self-copies and unsafe key names", () => {
    expect(
      EnvChangeListSchema.safeParse([
        { op: "set", key: "A", valueSource: "user" },
        { op: "unset", key: "A" },
      ]).success,
    ).toBe(false);
    expect(EnvChangeListSchema.safeParse([{ op: "set", key: "A", valueSource: "existing", from: { kind: "app_env", key: "A" } }]).success).toBe(false);
    for (const key of ["__proto__", "constructor", "prototype", "A=B", "A\nB", "A B", "1ABC", "", "A".repeat(129), "КЛЮЧ"]) {
      expect(EnvKeySchema.safeParse(key).success, JSON.stringify(key)).toBe(false);
    }
    expect(WireMappingSchema.safeParse({}).success).toBe(false);
    expect(WireMappingSchema.safeParse({ host: "X", port: "X" }).success).toBe(false);
  });

  it("lists the keys the user must type, and checks exact cover", () => {
    expect(userValueKeys(SAMPLE_PARAMS.set_env)).toEqual(["API_TOKEN"]);
    expect(userValueKeys(SAMPLE_PARAMS.deploy_plan)).toEqual(["SMTP_PASSWORD"]);
    expect(userValueKeys(SAMPLE_PARAMS.restart)).toEqual([]);
    expect(checkUserEnvValues(["API_TOKEN"], { API_TOKEN: "x" })).toEqual({ ok: true });
    expect(checkUserEnvValues(["API_TOKEN"], {})).toEqual({ ok: false, missing: ["API_TOKEN"], unexpected: [] });
    expect(checkUserEnvValues(["API_TOKEN"], { API_TOKEN: "x", OTHER: "y" })).toEqual({ ok: false, missing: [], unexpected: ["OTHER"] });
  });

  it("validates user-entered values", () => {
    expect(UserEnvValuesSchema.safeParse({ API_TOKEN: "abc" }).success).toBe(true);
    expect(UserEnvValuesSchema.safeParse({ API_TOKEN: "a\u0000b" }).success).toBe(false);
    expect(UserEnvValuesSchema.safeParse({ API_TOKEN: "x".repeat(16_385) }).success).toBe(false);
    // A `__proto__` key must never survive as an own key or alter the prototype (rejecting or dropping are both safe).
    const r = UserEnvValuesSchema.safeParse(JSON.parse('{"__proto__": {"polluted": "x"}, "A": "y"}'));
    if (r.success) {
      expect(Object.prototype.hasOwnProperty.call(r.data, "__proto__")).toBe(false);
      expect(Object.getPrototypeOf(r.data)).toBe(Object.prototype);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(UserEnvValuesSchema.safeParse({ "BAD KEY": "x" }).success).toBe(false);
  });
});
