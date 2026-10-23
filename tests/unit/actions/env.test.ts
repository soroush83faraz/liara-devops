// Env executors: read -> merge -> full-list write -> readback; value sources resolved server-side only.
import { describe, expect, it } from "vitest";
import { executeAction } from "../../../lib/actions/executors";
import { resolveEnvChanges } from "../../../lib/actions/env-values";
import { Run } from "../../../lib/actions/run";
import { ActionParamsSchema, type ActionParams } from "../../../lib/contracts/action";
import { getApp } from "../../../lib/liara";
import { prng } from "../contracts/samples";
import { setup, type TestEnv } from "./helpers";

const USER_SECRET = "user-typed-S3cret-value-9f8e7d";

const run = (env: TestEnv, params: ActionParams, userValues?: Record<string, string>) =>
  executeAction({ liara: env.liara.client(), accountId: env.accountId }, params, { source: "user", userValues });

const updateCalls = (env: TestEnv) => env.liara.calls.filter((c) => c.method === "POST" && c.path === "/v1/projects/update-envs");

describe("set_env", () => {
  it("merges into the FULL list, resolves every value source, reports key names only", async () => {
    const env = setup();
    env.liara.addApp("shop", {
      envs: [
        { key: "NODE_ENV", value: "production" },
        { key: "DB_URL", value: "postgres://root:old-pass-123456@shop-db:5432/app" },
        { key: "OLD_KEY", value: "old-value-abcdef" },
      ],
    });
    const result = await run(
      env,
      {
        type: "set_env",
        app: "shop",
        changes: [
          { op: "set", key: "SESSION_SECRET", valueSource: "generated", generator: "hex32" },
          { op: "set", key: "API_TOKEN", valueSource: "user" },
          { op: "set", key: "DATABASE_URL", valueSource: "existing", from: { kind: "app_env", key: "DB_URL" } },
          { op: "unset", key: "OLD_KEY" },
        ],
      },
      { API_TOKEN: USER_SECRET },
    );
    const after = env.liara.apps.get("shop")!.envs;
    expect(after.map((e) => e.key).sort()).toEqual(["API_TOKEN", "DATABASE_URL", "DB_URL", "NODE_ENV", "SESSION_SECRET"]);
    const secret = after.find((e) => e.key === "SESSION_SECRET")!.value;
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(after.find((e) => e.key === "API_TOKEN")!.value).toBe(USER_SECRET);
    expect(after.find((e) => e.key === "DATABASE_URL")!.value).toBe(after.find((e) => e.key === "DB_URL")!.value);

    // Exactly one full-list write, containing every surviving key.
    expect(updateCalls(env)).toHaveLength(1);
    const sent = (updateCalls(env)[0].body as { variables: Array<{ key: string }> }).variables.map((v) => v.key).sort();
    expect(sent).toEqual(["API_TOKEN", "DATABASE_URL", "DB_URL", "NODE_ENV", "SESSION_SECRET"]);

    const text = JSON.stringify(result.summary) + JSON.stringify(result.after ?? {});
    for (const v of [secret, USER_SECRET, "old-pass-123456", "old-value-abcdef"]) expect(text).not.toContain(v);
    expect(result.summary).toMatchObject({ generated: ["SESSION_SECRET"], userProvided: ["API_TOKEN"], unset: ["OLD_KEY"], readback: "ok", restartTriggered: true });
    expect(result.knownSecrets).toEqual(expect.arrayContaining([secret, USER_SECRET]));
  });

  it("never drops a key it was not asked to unset (randomized)", async () => {
    const rand = prng(7);
    for (let round = 0; round < 25; round++) {
      const env = setup();
      const keys = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => `K${i}`);
      env.liara.addApp("shop", { envs: keys.map((k, i) => ({ key: k, value: `value-${round}-${i}-xyz` })) });
      const touched = keys.filter(() => rand() < 0.4);
      const unset = keys.filter((k) => !touched.includes(k) && rand() < 0.3);
      const changes = [
        ...touched.map((key) => ({ op: "set" as const, key, valueSource: "generated" as const, generator: "base64url32" as const })),
        ...unset.map((key) => ({ op: "unset" as const, key })),
        { op: "set" as const, key: "NEW_ONE", valueSource: "generated" as const, generator: "hex32" as const },
      ];
      await run(env, ActionParamsSchema.parse({ type: "set_env", app: "shop", changes }));
      const after = env.liara.apps.get("shop")!.envs;
      for (const [i, k] of keys.entries()) {
        if (unset.includes(k)) expect(after.some((e) => e.key === k)).toBe(false);
        else if (!touched.includes(k)) expect(after.find((e) => e.key === k)?.value).toBe(`value-${round}-${i}-xyz`);
        else expect(after.find((e) => e.key === k)?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      }
    }
  });

  it("readback that loses or alters a value fails with key names only", async () => {
    const env = setup();
    env.liara.addApp("shop", { envs: [{ key: "KEEP", value: "keep-value-123456" }, { key: "OTHER", value: "other-value-123456" }] });
    env.liara.envUpdateHook = (app) => {
      app.envs = app.envs.filter((e) => e.key !== "OTHER");
    };
    await expect(run(env, { type: "set_env", app: "shop", changes: [{ op: "set", key: "NEW", valueSource: "generated", generator: "hex32" }] })).rejects.toMatchObject({
      code: "readback_mismatch",
      details: { missing: ["OTHER"] },
    });
  });

  it("refuses to rewrite the list when an encrypted variable came back masked [VAL]", async () => {
    const env = setup();
    env.liara.addApp("shop", { envs: [{ key: "STRIPE_KEY", value: "********", encrypted: true }] });
    await expect(run(env, { type: "unset_env", app: "shop", keys: ["NOPE"] })).rejects.toMatchObject({ code: "encrypted_env_masked" });
    await expect(run(env, { type: "set_env", app: "shop", changes: [{ op: "set", key: "A", valueSource: "generated", generator: "hex32" }] })).rejects.toMatchObject({
      code: "encrypted_env_masked",
    });
    expect(updateCalls(env)).toHaveLength(0);
  });

  it("user values: exact cover (missing and unexpected keys rejected before any call)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const params: ActionParams = { type: "set_env", app: "shop", changes: [{ op: "set", key: "API_TOKEN", valueSource: "user" }] };
    await expect(run(env, params)).rejects.toMatchObject({ code: "missing_user_value", details: { keys: ["API_TOKEN"] } });
    await expect(run(env, params, { API_TOKEN: "x-value-1234", EXTRA: "y" })).rejects.toMatchObject({ code: "unexpected_user_value" });
    await expect(run(env, { type: "restart", app: "shop" }, { ANY: "v" })).rejects.toMatchObject({ code: "unexpected_user_value" });
    expect(env.liara.calls).toHaveLength(0);
  });

  it("unset of absent keys is a no-op (no write, no restart)", async () => {
    const env = setup();
    env.liara.addApp("shop", { envs: [{ key: "A", value: "1" }] });
    const r = await run(env, { type: "unset_env", app: "shop", keys: ["MISSING"] });
    expect(r.summary).toMatchObject({ absent: ["MISSING"], restartTriggered: false, readback: "unchanged" });
    expect(updateCalls(env)).toHaveLength(0);
  });
});

describe("existing values from a database", () => {
  it("copies a DB field only within the same private network; password never in the summary", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const db = env.liara.addDb("shop-db");
    const r = await run(env, {
      type: "set_env",
      app: "shop",
      changes: [{ op: "set", key: "DB_PASSWORD", valueSource: "existing", from: { kind: "db", name: "shop-db", field: "password" } }],
    });
    expect(env.liara.apps.get("shop")!.envs.find((e) => e.key === "DB_PASSWORD")?.value).toBe(db.password);
    // knownSecrets is the server-side scrub list (never returned by a route); summary/after are what leave.
    expect(JSON.stringify({ summary: r.summary, after: r.after })).not.toContain(db.password!);
    expect(r.knownSecrets).toContain(db.password);
  });

  it("refuses a DB in another network (or without a network)", async () => {
    for (const network of [{ _id: "n2", name: "other" }, null]) {
      const env = setup();
      env.liara.addApp("shop");
      env.liara.addDb("shop-db", { network });
      await expect(
        run(env, { type: "set_env", app: "shop", changes: [{ op: "set", key: "DB_PASSWORD", valueSource: "existing", from: { kind: "db", name: "shop-db", field: "password" } }] }),
      ).rejects.toMatchObject({ code: "different_network" });
      expect(updateCalls(env)).toHaveLength(0);
    }
  });

  it("never copies an existing value into a browser-exposed key (schema and server)", async () => {
    const env = setup();
    const app = env.liara.addApp("shop", { envs: [{ key: "SECRET", value: "s3cret-value-123456" }] });
    const bad = { type: "set_env", app: "shop", changes: [{ op: "set", key: "NEXT_PUBLIC_SECRET", valueSource: "existing", from: { kind: "app_env", key: "SECRET" } }] };
    expect(ActionParamsSchema.safeParse(bad).success).toBe(false);
    await expect(run(env, bad as ActionParams)).rejects.toMatchObject({ code: "invalid" });
    // Even if a caller bypassed the schema, the resolver refuses.
    const r = new Run({ liara: env.liara.client(), accountId: env.accountId }, { source: "user" });
    const detail = await getApp(env.liara.client(), "shop");
    await expect(
      resolveEnvChanges(r, detail, [{ op: "set", key: "NEXT_PUBLIC_SECRET", valueSource: "existing", from: { kind: "app_env", key: "SECRET" } }]),
    ).rejects.toMatchObject({ code: "public_key_forbidden" });
    expect(app.envs).toHaveLength(1);
  });
});

describe("wire_db", () => {
  it("writes host/port/user/password/database/url for the same network; summary has key names only", async () => {
    const env = setup();
    env.liara.addApp("shop", { envs: [{ key: "KEEP", value: "keep-value-123456" }] });
    const db = env.liara.addDb("shop-db", { password: "p@ss/w0rd#SYNTH" });
    const r = await run(env, {
      type: "wire_db",
      app: "shop",
      db: "shop-db",
      mapping: { host: "DB_HOST", port: "DB_PORT", user: "DB_USER", password: "DB_PASSWORD", database: "DB_NAME", url: "DATABASE_URL" },
    });
    const envs = Object.fromEntries(env.liara.apps.get("shop")!.envs.map((e) => [e.key, e.value]));
    expect(envs).toMatchObject({ KEEP: "keep-value-123456", DB_HOST: "shop-db", DB_PORT: "5432", DB_USER: "root", DB_PASSWORD: db.password, DB_NAME: "appdb" });
    expect(envs.DATABASE_URL).toBe(`postgresql://root:${encodeURIComponent(db.password!)}@shop-db:5432/appdb`);
    expect(r.summary).toMatchObject({ app: "shop", db: "shop-db", network: "main" });
    expect((r.summary.wired as Array<{ key: string }>).map((w) => w.key)).toContain("DB_PASSWORD");
    const text = JSON.stringify(r.summary);
    expect(text).not.toContain(db.password!);
    expect(text).not.toContain(encodeURIComponent(db.password!));
    expect(r.knownSecrets).toEqual(expect.arrayContaining([db.password, envs.DATABASE_URL]));
  });

  it("refuses a different network", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.addDb("shop-db", { network: { _id: "n9", name: "elsewhere" } });
    await expect(run(env, { type: "wire_db", app: "shop", db: "shop-db", mapping: { host: "DB_HOST" } })).rejects.toMatchObject({ code: "different_network" });
    expect(updateCalls(env)).toHaveLength(0);
  });
});
