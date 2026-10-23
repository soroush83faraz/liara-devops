// Mutations are sent exactly once. An ambiguous failure (5xx, timeout, lost connection) is followed by a
// re-read of the real state, never by a resend.
import { describe, expect, it } from "vitest";
import { executeAction } from "../../../lib/actions/executors";
import type { ActionParams } from "../../../lib/contracts/action";
import { setup, type TestEnv } from "./helpers";

const exec = (env: TestEnv, params: ActionParams, timeoutMs = 2000) =>
  executeAction({ liara: env.liara.client({ timeoutMs }), accountId: env.accountId }, params, { source: "user" });

const count = (env: TestEnv, method: string, path: string) => env.liara.calls.filter((c) => c.method === method && c.path === path).length;

const after = (env: TestEnv, method: string, path: string) => {
  const i = env.liara.calls.findIndex((c) => c.method === method && c.path === path);
  return env.liara.calls.slice(i + 1);
};

describe("no retry on ambiguous failures", () => {
  it.each([
    ["500", { status: 500 }],
    ["502", { status: 502 }],
    ["network error", { network: true as const }],
  ])("restart answered %s -> outcome_unknown after a re-read; exactly one POST", async (_n, fault) => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("POST /v1/projects/shop/actions/restart", fault);
    await expect(exec(env, { type: "restart", app: "shop" })).rejects.toMatchObject({ code: "outcome_unknown", details: { step: "restart" } });
    expect(count(env, "POST", "/v1/projects/shop/actions/restart")).toBe(1);
    expect(after(env, "POST", "/v1/projects/shop/actions/restart").some((c) => c.method === "GET" && c.path === "/v1/projects/shop")).toBe(true);
  });

  it("restart that times out -> one POST, state re-read", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("POST /v1/projects/shop/actions/restart", { hang: true });
    await expect(exec(env, { type: "restart", app: "shop" }, 50)).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(count(env, "POST", "/v1/projects/shop/actions/restart")).toBe(1);
  });

  it("env update applied but answer lost -> re-read confirms; no second write", async () => {
    const env = setup();
    env.liara.addApp("shop", { envs: [{ key: "A", value: "a-value-123456" }] });
    env.liara.fault("POST /v1/projects/update-envs", { status: 504, applied: true });
    const r = await exec(env, { type: "set_env", app: "shop", changes: [{ op: "set", key: "B", valueSource: "generated", generator: "hex32" }] });
    expect(r.confirmedByReread).toBe(true);
    expect(count(env, "POST", "/v1/projects/update-envs")).toBe(1);
    expect(env.liara.apps.get("shop")!.envs.map((e) => e.key)).toEqual(["A", "B"]);
  });

  it("env update not applied and answer lost -> outcome_unknown; no second write", async () => {
    const env = setup();
    env.liara.addApp("shop", { envs: [{ key: "A", value: "a-value-123456" }] });
    env.liara.fault("POST /v1/projects/update-envs", { status: 500 });
    await expect(exec(env, { type: "set_env", app: "shop", changes: [{ op: "set", key: "B", valueSource: "generated", generator: "hex32" }] })).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(count(env, "POST", "/v1/projects/update-envs")).toBe(1);
  });

  it("create_app timed out but was created -> confirmed by refetch, never created twice", async () => {
    const env = setup();
    env.liara.networks.push({ _id: "n1", name: "main" });
    env.liara.fault("POST /v1/projects", { hang: true, applied: true });
    const r = await exec(env, { type: "create_app", name: "fresh", platform: "node", planId: "small-g2", network: "main" }, 50);
    expect(r.confirmedByReread).toBe(true);
    expect(count(env, "POST", "/v1/projects")).toBe(1);
    expect(env.liara.apps.get("fresh")?.network).toEqual({ _id: "n1", name: "main" });
  });

  it("a definite refusal (409) is reported as-is, without a re-read", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("POST /v1/projects/shop/actions/restart", { status: 409 });
    await expect(exec(env, { type: "restart", app: "shop" })).rejects.toMatchObject({ code: "conflict" });
    expect(after(env, "POST", "/v1/projects/shop/actions/restart")).toHaveLength(0);
  });

  it("scale applied but answer lost -> confirmed by re-reading scale", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("POST /v1/projects/shop/actions/scale", { status: 502, applied: true });
    const r = await exec(env, { type: "scale", resource: { kind: "app", name: "shop" }, scale: 0 });
    expect(r.confirmedByReread).toBe(true);
    expect(count(env, "POST", "/v1/projects/shop/actions/scale")).toBe(1);
  });

  it("error objects never carry upstream text", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("POST /v1/projects/shop/actions/restart", { status: 400, json: { message: "value super-secret-echo-123 invalid" } });
    const err = await exec(env, { type: "restart", app: "shop" }).catch((e: unknown) => e);
    expect(JSON.stringify(err)).not.toContain("super-secret-echo");
    expect(String((err as Error).message)).not.toContain("super-secret-echo");
  });
});
