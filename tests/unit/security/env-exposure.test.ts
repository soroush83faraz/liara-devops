// S9 regression: the browser-exposed key rule was an allow-by-prefix list that missed NX_PUBLIC_, NG_APP_,
// REDWOOD_ENV_, SANITY_STUDIO_, UMI_APP_, TAURI_ ..., so an `existing` secret copy or a DB wiring could publish a
// credential in a client bundle. The deny rule is now broader and enforced in the contract AND in the executors
// (human /api/ops, set_env resolver, wire_db). SYNTHETIC values only.
import { describe, expect, it } from "vitest";
import { handleOps } from "@/lib/actions/http/ops";
import { resolveEnvChanges } from "@/lib/actions/env-values";
import { execWireDb } from "@/lib/actions/exec-env";
import { Run } from "@/lib/actions/run";
import { EnvChangeListSchema, WireMappingSchema, isExposedEnvKey, isPublicEnvKey } from "@/lib/contracts/env";
import { getApp } from "@/lib/liara";
import { body, ctxFor, setup } from "../actions/helpers";

const EXPOSED = [
  // the verifier's misses
  "NX_PUBLIC_DB_PASSWORD", "NG_APP_DB_PASSWORD", "REDWOOD_ENV_DB_PASSWORD", "SANITY_STUDIO_TOKEN", "UMI_APP_KEY", "TAURI_PRIVATE",
  // other framework prefixes
  "NEXT_PUBLIC_X", "VITE_DB", "REACT_APP_T", "VUE_APP_T", "NUXT_PUBLIC_T", "NUXT_ENV_T", "GATSBY_T", "EXPO_PUBLIC_T", "PUBLIC_T",
  "STORYBOOK_T", "PARCEL_T", "SNOWPACK_PUBLIC_T", "WMR_T", "QWIK_PUBLIC_T", "ASTRO_PUBLIC_T", "BUN_PUBLIC_T", "RAZZLE_T", "next_public_lower",
  // name segments that announce a client-side value
  "MY_PUBLIC_KEY", "APP_PUBLIC", "CLIENT_DB_URL", "STRIPE_CLIENT_TOKEN", "DB_EXPOSED", "EXPOSE_SECRET", "BROWSER_KEY", "FRONTEND_TOKEN",
];
const PRIVATE = ["DATABASE_URL", "DB_PASSWORD", "SECRET", "PUBLISHER", "REPUBLIC_ID", "CLIENTELE", "SESSION_SECRET", "API_KEY"];

describe("isExposedEnvKey (deny rule for secret copies)", () => {
  it("covers framework prefixes and client-side name segments", () => {
    for (const k of EXPOSED) expect(isExposedEnvKey(k), k).toBe(true);
    for (const k of PRIVATE) expect(isExposedEnvKey(k), k).toBe(false);
  });

  it("the UI warning list (framework prefixes) includes the previously missing frameworks", () => {
    for (const k of ["NX_PUBLIC_A", "NG_APP_A", "REDWOOD_ENV_A", "SANITY_STUDIO_A", "UMI_APP_A"]) expect(isPublicEnvKey(k), k).toBe(true);
  });

  it("the contract refuses existing copies and DB wiring into every exposed key", () => {
    for (const key of EXPOSED) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      expect(WireMappingSchema.safeParse({ password: key }).success, `wire ${key}`).toBe(false);
      expect(
        EnvChangeListSchema.safeParse([{ op: "set", key, valueSource: "existing", from: { kind: "app_env", key: "DATABASE_URL" } }]).success,
        `copy ${key}`,
      ).toBe(false);
      // the user may still type a value, and a generated value publishes nothing pre-existing
      expect(EnvChangeListSchema.safeParse([{ op: "set", key, valueSource: "user" }]).success).toBe(true);
    }
    for (const key of PRIVATE) expect(WireMappingSchema.safeParse({ url: key }).success, key).toBe(true);
  });
});

describe("executors re-check the rule (schema bypassed)", () => {
  it("set_env resolver refuses an existing copy into NG_APP_ / NX_PUBLIC_ keys", async () => {
    const env = setup();
    env.liara.addApp("shop", { envs: [{ key: "SECRET", value: "s3cret-value-SYNTH-123456" }] });
    const r = new Run({ liara: env.liara.client(), accountId: env.accountId }, { source: "user" });
    const detail = await getApp(env.liara.client(), "shop");
    for (const key of ["NG_APP_SECRET", "NX_PUBLIC_SECRET", "CLIENT_SECRET_COPY"]) {
      await expect(resolveEnvChanges(r, detail, [{ op: "set", key, valueSource: "existing", from: { kind: "app_env", key: "SECRET" } }])).rejects.toMatchObject({
        code: "public_key_forbidden",
      });
    }
  });

  it("wire_db refuses a client-exposed target key before reading the database", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.addDb("shop-db", { password: "p@ss-SYNTH-998877" });
    const r = new Run({ liara: env.liara.client(), accountId: env.accountId }, { source: "user" });
    await expect(execWireDb(r, { type: "wire_db", app: "shop", db: "shop-db", mapping: { password: "REDWOOD_ENV_DB_PASSWORD" } })).rejects.toMatchObject({
      code: "public_key_forbidden",
    });
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("the human /api/ops path refuses it too", async () => {
    const env = setup();
    env.liara.addApp("shop", { envs: [{ key: "SECRET", value: "s3cret-value-SYNTH-123456" }] });
    env.liara.addDb("shop-db", { password: "p@ss-SYNTH-998877" });
    const copy = await handleOps(
      ctxFor(env, { body: { params: { type: "set_env", app: "shop", changes: [{ op: "set", key: "UMI_APP_SECRET", valueSource: "existing", from: { kind: "app_env", key: "SECRET" } }] } } }),
      env.deps,
    );
    expect(copy.status).toBe(400);
    const wire = await handleOps(ctxFor(env, { body: { params: { type: "wire_db", app: "shop", db: "shop-db", mapping: { url: "SANITY_STUDIO_DB_URL" } } } }), env.deps);
    expect(wire.status).toBe(400);
    expect(JSON.stringify(await body(wire))).not.toContain("SYNTH");
    expect(env.liara.mutations()).toHaveLength(0);
  });
});
