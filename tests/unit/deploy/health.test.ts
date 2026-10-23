import { describe, expect, it } from "vitest";
import { buildHealth } from "@/lib/deploy/health";
import type { PersistenceDeps } from "@/lib/deploy/persistence";
import { probeDataDir, type DataDirFs } from "@/lib/deploy/startup-check";

const KEY = "k".repeat(48);
const fsOf = (over: Partial<DataDirFs> = {}): DataDirFs => ({
  exists: async () => true,
  mkdir: async () => {},
  writeProbe: async () => {},
  ...over,
});
// Deterministic mount table: DATA_DIR sits on a mounted disk regardless of where the tests run.
const mountedDeps: PersistenceDeps = {
  platform: "linux",
  readMountInfo: async () => "1 0 0:1 / / rw - overlay overlay rw\n2 1 254:1 / /d rw - ext4 /dev/rbd0 rw",
  realpath: async (p) => p,
};
const err = (code: string) => Object.assign(new Error(code), { code });

describe("probeDataDir", () => {
  it("reports writable, readonly and missing", async () => {
    expect(await probeDataDir("/d", fsOf())).toBe("writable");
    expect(await probeDataDir("/d", fsOf({ writeProbe: async () => { throw err("EROFS"); } }))).toBe("readonly");
    expect(await probeDataDir("/d", fsOf({ exists: async () => false, mkdir: async () => { throw err("ENOENT"); } }))).toBe("missing");
    expect(await probeDataDir("/d", fsOf({ exists: async () => false, mkdir: async () => { throw err("EACCES"); } }))).toBe("readonly");
  });

  it("does not hang on a wedged filesystem", async () => {
    const never = new Promise<never>(() => {});
    expect(await probeDataDir("/d", fsOf({ writeProbe: () => never }), 20)).toBe("missing");
  });

  it("creates the directory when absent but creatable", async () => {
    let made = false;
    const state = await probeDataDir("/d", fsOf({ exists: async () => false, mkdir: async () => { made = true; } }));
    expect(made).toBe(true);
    expect(state).toBe("writable");
  });
});

describe("buildHealth", () => {
  it("is 200/ok in production with a key and a writable disk, with the documented shape", async () => {
    const r = await buildHealth({ NODE_ENV: "production", APP_SESSION_KEY: KEY, DATA_DIR: "/d" }, fsOf(), 12.9, mountedDeps);
    expect(r.httpStatus).toBe(200);
    expect(r.body).toEqual({
      status: "ok",
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      uptimeSec: 12,
      checks: { sessionKey: true, dataDir: "writable", dataDirPersistent: "mounted", llmConfigured: false },
    });
  });

  it("is 503 in production when the session key is missing or short", async () => {
    for (const k of [undefined, "short"]) {
      const r = await buildHealth({ NODE_ENV: "production", APP_SESSION_KEY: k }, fsOf());
      expect(r.httpStatus).toBe(503);
      expect(r.body.status).toBe("unavailable");
      expect(r.body.checks.sessionKey).toBe(false);
    }
  });

  it("is 503 in production when DATA_DIR is not writable", async () => {
    const r = await buildHealth({ NODE_ENV: "production", APP_SESSION_KEY: KEY }, fsOf({ writeProbe: async () => { throw err("EROFS"); } }));
    expect(r.httpStatus).toBe(503);
    expect(r.body.checks.dataDir).toBe("readonly");
  });

  it("never returns 503 outside production", async () => {
    const r = await buildHealth({ NODE_ENV: "development" }, fsOf({ writeProbe: async () => { throw err("EROFS"); } }));
    expect(r.httpStatus).toBe(200);
  });

  it("reports llmConfigured only when all three settings exist, and leaks no values", async () => {
    const env = { NODE_ENV: "production", APP_SESSION_KEY: KEY, LIARA_AI_BASE_URL: "https://ai.example/v1", LIARA_AI_API_KEY: "sk-very-secret", LLM_MODEL: "model-x", DATA_DIR: "/mnt/secret-path" };
    const r = await buildHealth(env, fsOf(), 1, mountedDeps);
    expect(r.body.checks.llmConfigured).toBe(true);
    const json = JSON.stringify(r.body);
    for (const leak of [KEY, "sk-very-secret", "ai.example", "model-x", "/mnt/secret-path"]) expect(json).not.toContain(leak);
    expect(Object.keys(r.body.checks).sort()).toEqual(["dataDir", "dataDirPersistent", "llmConfigured", "sessionKey"]);
  });
});
