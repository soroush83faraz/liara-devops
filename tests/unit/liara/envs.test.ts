import { describe, expect, it } from "vitest";
import { applyEnvOps, getEnvs, maskEnvs, mergeEnvs, updateEnvs, type EnvInput } from "../../../lib/liara";
import detailFx from "../../fixtures/liara/app-detail.synthetic.json";
import { routes } from "./helpers";

const current: EnvInput[] = [
  { key: "A", value: "1" },
  { key: "B", value: "2" },
  { key: "C", value: "3" },
];

describe("mergeEnvs", () => {
  it("adds, updates in place and deletes without touching other keys", () => {
    const out = mergeEnvs(current, [
      { op: "set", key: "B", value: "two" },
      { op: "set", key: "D", value: "4" },
      { op: "unset", key: "A" },
    ]);
    expect(out).toEqual([
      { key: "B", value: "two" },
      { key: "C", value: "3" },
      { key: "D", value: "4" },
    ]);
  });

  it("never drops keys it was not asked to unset (property-style check)", () => {
    const keys = ["K1", "K2", "K3", "K4"];
    for (let mask = 0; mask < 16; mask++) {
      const cur = keys.map((k, i) => ({ key: k, value: `v${i}` }));
      const touched = keys.filter((_, i) => mask & (1 << i));
      const out = mergeEnvs(cur, touched.map((k) => ({ op: "set" as const, key: k, value: "new" })));
      expect(out.map((e) => e.key)).toEqual(keys);
      for (const e of out) expect(e.value).toBe(touched.includes(e.key) ? "new" : cur.find((c) => c.key === e.key)!.value);
    }
  });

  it("is pure, order-preserving, drops only metadata and unsets unknown keys as a no-op", () => {
    const input = [{ key: "A", value: "1", encrypted: true, _id: "x" }];
    const snapshot = JSON.stringify(input);
    const out = mergeEnvs(input, [{ op: "unset", key: "NOPE" }]);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).toEqual([{ key: "A", value: "1" }]);
  });

  it("collapses duplicate keys on set and keeps empty values", () => {
    expect(mergeEnvs([{ key: "A", value: "1" }, { key: "B", value: "b" }, { key: "A", value: "2" }], [{ op: "set", key: "A", value: "" }])).toEqual([
      { key: "A", value: "" },
      { key: "B", value: "b" },
    ]);
  });

  it("rejects invalid keys", () => {
    for (const key of ["", "a b", "A=B", "x\n"]) expect(() => mergeEnvs([], [{ op: "set", key, value: "v" }])).toThrow();
  });
});

describe("maskEnvs", () => {
  it("never leaks values or their length", () => {
    const masked = maskEnvs([
      { key: "SHORT", value: "x" },
      { key: "LONG", value: "a-very-long-secret-value", encrypted: true },
      { key: "EMPTY", value: "" },
    ]);
    expect(masked.map((m) => m.key)).toEqual(["SHORT", "LONG", "EMPTY"]);
    expect(masked[0].value).toBe(masked[1].value);
    expect(JSON.stringify(masked)).not.toContain("secret");
    expect(masked[2].value).toBe("");
    expect(masked[1].encrypted).toBe(true);
  });
});

describe("updateEnvs", () => {
  it("posts the FULL list as {project, variables:[{key,value}]}", async () => {
    const { client, calls } = routes({ "POST /v1/projects/update-envs": { json: { message: "ok" } } });
    await updateEnvs(client, "demo-shop", [{ key: "A", value: "1" }, { key: "B", value: "2" }]);
    expect(calls[0].body).toEqual({ project: "demo-shop", variables: [{ key: "A", value: "1" }, { key: "B", value: "2" }] });
  });

  it("refuses empty lists (would wipe everything) unless allowEmpty, and duplicates", async () => {
    const { client, calls } = routes({ "POST /v1/projects/update-envs": {} });
    await expect(updateEnvs(client, "a", [])).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(updateEnvs(client, "a", [{ key: "A", value: "1" }, { key: "A", value: "2" }])).rejects.toMatchObject({ code: "invalid_argument" });
    expect(calls).toHaveLength(0);
    await updateEnvs(client, "a", [], { allowEmpty: true });
    expect(calls).toHaveLength(1);
  });

  it("does not retry on 5xx", async () => {
    const { client, calls } = routes({ "POST /v1/projects/update-envs": { status: 500, json: {} } });
    await expect(updateEnvs(client, "a", [{ key: "A", value: "1" }])).rejects.toMatchObject({ kind: "server" });
    expect(calls).toHaveLength(1);
  });
});

describe("applyEnvOps (read -> merge -> write full list -> readback)", () => {
  function stateful() {
    let envs = structuredClone(detailFx.project.envs);
    return routes({
      "GET /v1/projects/demo-shop": () => ({ json: { project: { ...detailFx.project, envs } } }),
      "POST /v1/projects/update-envs": (c) => {
        envs = (c.body as { variables: Array<{ key: string; value: string }> }).variables.map((v, i) => ({ ...v, encrypted: false, _id: `n${i}` }));
        return { json: { message: "ok" } };
      },
    });
  }

  it("sends every existing key plus the change and verifies on readback", async () => {
    const { client, calls } = stateful();
    const res = await applyEnvOps(client, "demo-shop", [{ op: "set", key: "FEATURE_X", value: "on" }]);
    const sent = (calls.find((c) => c.method === "POST")!.body as { variables: EnvInput[] }).variables;
    expect(sent.map((v) => v.key)).toEqual(["NODE_ENV", "DATABASE_URL", "API_KEY", "FEATURE_X"]);
    expect(res.verified).toBe(true);
    expect(res.keysAfter).toContain("FEATURE_X");
    expect(JSON.stringify(res)).not.toContain("SYNTH-SECRET");
  });

  it("unset removes exactly one key", async () => {
    const { client } = stateful();
    const res = await applyEnvOps(client, "demo-shop", [{ op: "unset", key: "API_KEY" }]);
    expect(res.keysAfter).toEqual(["NODE_ENV", "DATABASE_URL"]);
    expect(res.verified).toBe(true);
  });

  it("reports verified=false when the server silently drops a variable", async () => {
    const r = routes({
      "GET /v1/projects/demo-shop": { json: detailFx },
      "POST /v1/projects/update-envs": { json: { message: "ok" } },
    });
    const res = await applyEnvOps(r.client, "demo-shop", [{ op: "set", key: "NEW", value: "1" }]);
    expect(res.verified).toBe(false);
    expect(res.missingAfter).toEqual(["NEW"]);
  });

  it("getEnvs reads from the app detail", async () => {
    const { client } = routes({ "GET /v1/projects/demo-shop": { json: detailFx } });
    expect((await getEnvs(client, "demo-shop")).map((e) => e.key)).toEqual(["NODE_ENV", "DATABASE_URL", "API_KEY"]);
  });
});
