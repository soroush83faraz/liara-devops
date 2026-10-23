import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHealth } from "@/lib/deploy/health";
import { classifyPersistence, detectDataDirPersistence, parseMountInfo, startupLine, type PersistenceDeps } from "@/lib/deploy/persistence";
import { logStartupLine, resetStartupLogState, type DataDirFs } from "@/lib/deploy/startup-check";

const OVERLAY_ONLY = [
  "1021 790 0:93 / / rw,relatime master:350 - overlay overlay rw,lowerdir=/x,upperdir=/y,workdir=/z",
  "1022 1021 0:96 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw",
  "1023 1021 0:97 / /dev rw,nosuid - tmpfs tmpfs rw,size=65536k,mode=755",
  "1024 1023 0:98 / /dev/shm rw,nosuid,nodev,noexec,relatime - tmpfs shm rw,size=65536k",
  "1025 1021 0:99 / /sys ro,nosuid,nodev,noexec,relatime - sysfs sysfs ro",
  "1026 1021 254:1 /etc/resolv.conf /etc/resolv.conf rw,relatime - ext4 /dev/vda1 rw",
  "1027 1021 254:1 /etc/hosts /etc/hosts rw,relatime - ext4 /dev/vda1 rw",
  "1028 1021 254:1 /etc/hostname /etc/hostname rw,relatime - ext4 /dev/vda1 rw",
].join("\n");
const WITH_DISK = `${OVERLAY_ONLY}\n1100 1021 254:16 / /app/data rw,relatime - ext4 /dev/rbd0 rw`;
const WITH_SPACE = `${OVERLAY_ONLY}\n1101 1021 254:17 / /mnt/my\\040disk rw,relatime - xfs /dev/rbd1 rw`;

describe("parseMountInfo", () => {
  it("reads field 5 and the fs type, unescaping octal sequences", () => {
    const m = parseMountInfo(WITH_SPACE);
    expect(m[0]).toEqual({ mountPoint: "/", fsType: "overlay" });
    expect(m.at(-1)).toEqual({ mountPoint: "/mnt/my disk", fsType: "xfs" });
  });
  it("skips malformed lines", () => {
    expect(parseMountInfo("garbage\n\n1 2 3")).toEqual([]);
  });
});

describe("classifyPersistence", () => {
  it("overlay root only => not_mounted", () => {
    expect(classifyPersistence("/app/data", parseMountInfo(OVERLAY_ONLY))).toBe("not_mounted");
  });
  it("a disk mounted at the dir, or at a parent of it => mounted", () => {
    expect(classifyPersistence("/app/data", parseMountInfo(WITH_DISK))).toBe("mounted");
    expect(classifyPersistence("/app/data/v1/deep", parseMountInfo(WITH_DISK))).toBe("mounted");
    expect(classifyPersistence("/mnt/my disk/sub", parseMountInfo(WITH_SPACE))).toBe("mounted");
  });
  it("a sibling with a common name prefix is not a parent", () => {
    expect(classifyPersistence("/app/data-old", parseMountInfo(WITH_DISK))).toBe("not_mounted");
  });
  it("ignores /proc, /sys, /dev and etc bind mounts, and tmpfs mounts", () => {
    expect(classifyPersistence("/dev/shm/x", parseMountInfo(OVERLAY_ONLY))).toBe("not_mounted");
    expect(classifyPersistence("/etc/hosts", parseMountInfo(OVERLAY_ONLY))).toBe("not_mounted");
    const tmp = `${OVERLAY_ONLY}\n1200 1021 0:120 / /app/data rw - tmpfs tmpfs rw`;
    expect(classifyPersistence("/app/data", parseMountInfo(tmp))).toBe("not_mounted");
  });
  it("the deepest mount decides (a tmpfs over a disk is not persistent)", () => {
    const t = `${WITH_DISK}\n1300 1100 0:130 / /app/data/cache rw - tmpfs tmpfs rw`;
    expect(classifyPersistence("/app/data/cache/x", parseMountInfo(t))).toBe("not_mounted");
    expect(classifyPersistence("/app/data/x", parseMountInfo(t))).toBe("mounted");
  });
  it("an empty table or a relative dir => unknown", () => {
    expect(classifyPersistence("/app/data", [])).toBe("unknown");
    expect(classifyPersistence("data", parseMountInfo(WITH_DISK))).toBe("unknown");
  });
});

const depsOf = (over: Partial<PersistenceDeps> = {}): PersistenceDeps => ({
  platform: "linux",
  readMountInfo: async () => WITH_DISK,
  realpath: async (p) => p,
  ...over,
});

describe("detectDataDirPersistence", () => {
  it("resolves the dir against cwd and follows symlinks", async () => {
    const r = await detectDataDirPersistence("./data", depsOf({ realpath: async (p) => (p.endsWith("/data") ? "/app/data" : p) }));
    expect(r).toEqual({ state: "mounted", resolvedDir: "/app/data" });
  });
  it("falls back to the lexical path when the dir does not exist yet", async () => {
    const r = await detectDataDirPersistence("/app/data", depsOf({ realpath: async () => { throw new Error("ENOENT"); } }));
    expect(r).toEqual({ state: "mounted", resolvedDir: "/app/data" });
  });
  it("unreadable /proc or a non-Linux platform => unknown", async () => {
    expect((await detectDataDirPersistence("/app/data", depsOf({ readMountInfo: async () => { throw new Error("EACCES"); } }))).state).toBe("unknown");
    expect((await detectDataDirPersistence("/app/data", depsOf({ platform: "darwin" }))).state).toBe("unknown");
  });
  it("overlay-only table => not_mounted", async () => {
    expect((await detectDataDirPersistence("/app/data", depsOf({ readMountInfo: async () => OVERLAY_ONLY }))).state).toBe("not_mounted");
  });
});

const KEY = "k".repeat(48);
const fs: DataDirFs = { exists: async () => true, mkdir: async () => {}, writeProbe: async () => {} };
const prod = { NODE_ENV: "production", APP_SESSION_KEY: KEY, DATA_DIR: "/app/data" };

describe("health: dataDirPersistent", () => {
  it("mounted => ok; not_mounted in production => degraded but still HTTP 200; no paths in the body", async () => {
    const ok = await buildHealth(prod, fs, 1, depsOf());
    expect(ok.httpStatus).toBe(200);
    expect(ok.body.status).toBe("ok");
    expect(ok.body.checks.dataDirPersistent).toBe("mounted");
    const bad = await buildHealth(prod, fs, 1, depsOf({ readMountInfo: async () => OVERLAY_ONLY }));
    expect(bad.httpStatus).toBe(200);
    expect(bad.body.status).toBe("degraded");
    expect(bad.body.checks.dataDirPersistent).toBe("not_mounted");
    const json = JSON.stringify(bad.body);
    for (const leak of ["/app", "/dev/rbd0", "overlay", "ext4", "mnt"]) expect(json).not.toContain(leak);
    expect(Object.keys(bad.body.checks).sort()).toEqual(["dataDir", "dataDirPersistent", "llmConfigured", "sessionKey"]);
  });
  it("unknown stays ok; outside production not_mounted is not degraded; a broken config is still 503", async () => {
    expect((await buildHealth(prod, fs, 1, depsOf({ platform: "win32" }))).body.status).toBe("ok");
    expect((await buildHealth({ NODE_ENV: "development" }, fs, 1, depsOf({ readMountInfo: async () => OVERLAY_ONLY }))).body.status).toBe("ok");
    const broken = await buildHealth({ ...prod, APP_SESSION_KEY: "short" }, fs, 1, depsOf({ readMountInfo: async () => OVERLAY_ONLY }));
    expect(broken.httpStatus).toBe(503);
    expect(broken.body.status).toBe("unavailable");
  });
});

describe("startup log line", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetStartupLogState();
  });
  it("has the documented shape and no secrets", () => {
    expect(startupLine({ state: "not_mounted", resolvedDir: "/app/data" }, "/app", "v22.1.0")).toBe("[startup] cwd=/app dataDir=/app/data persistent=not_mounted node=v22.1.0");
  });
  it("logs exactly one line per process and never env values", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { checkProductionConfig } = await import("@/lib/deploy/startup-check");
    const report = await checkProductionConfig({ ...prod, LIARA_AI_API_KEY: "sk-very-secret" }, fs, depsOf());
    logStartupLine(report);
    logStartupLine(report);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toMatch(/^\[startup\] cwd=\S+ dataDir=\/app\/data persistent=mounted node=v\d+/);
    for (const leak of [KEY, "sk-very-secret"]) expect(line).not.toContain(leak);
  });
});
