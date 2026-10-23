import { describe, expect, it } from "vitest";
import { PowerBodySchema, PublicNetworkBodySchema, ResizeBodySchema, ControlPanelBodySchema, isValidBackupName, parseBody } from "../../../lib/service/db/bodies";
import { diskPercent } from "../../../lib/service/db/disk";
import { engineMeta } from "../../../lib/service/db/engines";
import { formatBytes, isSafeHttpUrl } from "../../../lib/service/db/format";
import { mapDbStatus } from "../../../lib/service/db/status";

describe("mapDbStatus", () => {
  it("RUNNING (any case) is running", () => {
    expect(mapDbStatus({ status: "RUNNING", scale: 1 })).toBe("running");
    expect(mapDbStatus({ status: "running" })).toBe("running");
  });
  it("scale 0 wins over the raw status", () => {
    expect(mapDbStatus({ status: "RUNNING", scale: 0 })).toBe("stopped");
  });
  it("unrecognised or missing status stays unknown, never guessed", () => {
    expect(mapDbStatus({ status: "WEIRD_STATE", scale: 1 })).toBe("unknown");
    expect(mapDbStatus({})).toBe("unknown");
    expect(mapDbStatus({ status: null, scale: null })).toBe("unknown");
  });
  it("maps known aliases", () => {
    expect(mapDbStatus({ status: "FAILED" })).toBe("failed");
    expect(mapDbStatus({ status: "PENDING" })).toBe("building");
  });
});

describe("body schemas", () => {
  it("public-network requires a boolean and the typed name, rejects unknown keys", () => {
    expect(PublicNetworkBodySchema.safeParse({ enable: true, typedName: "db" }).success).toBe(true);
    expect(PublicNetworkBodySchema.safeParse({ enable: "yes", typedName: "db" }).success).toBe(false);
    expect(PublicNetworkBodySchema.safeParse({ enable: true }).success).toBe(false);
    expect(PublicNetworkBodySchema.safeParse({ enable: true, typedName: "db", extra: 1 }).success).toBe(false);
  });
  it("power accepts only 0 or 1", () => {
    expect(PowerBodySchema.safeParse({ scale: 0, typedName: "db" }).success).toBe(true);
    expect(PowerBodySchema.safeParse({ scale: 1, typedName: "db" }).success).toBe(true);
    expect(PowerBodySchema.safeParse({ scale: 2, typedName: "db" }).success).toBe(false);
  });
  it("resize validates the plan id charset", () => {
    expect(ResizeBodySchema.safeParse({ planID: "small-g2", typedName: "db" }).success).toBe(true);
    expect(ResizeBodySchema.safeParse({ planID: "../x", typedName: "db" }).success).toBe(false);
    expect(ResizeBodySchema.safeParse({ planID: "", typedName: "db" }).success).toBe(false);
  });
  it("control panel typed name is optional at the schema level", () => {
    expect(ControlPanelBodySchema.safeParse({ enable: false }).success).toBe(true);
  });
  it("parseBody returns undefined for malformed or oversized JSON", async () => {
    const mk = (body: string) => new Request("http://x.test/", { method: "POST", body });
    expect(await parseBody(mk("{not json"), PowerBodySchema)).toBeUndefined();
    expect(await parseBody(mk(JSON.stringify({ scale: 1, typedName: "a".repeat(5000) })), PowerBodySchema)).toBeUndefined();
    expect(await parseBody(mk(JSON.stringify({ scale: 1, typedName: "db" })), PowerBodySchema)).toEqual({ scale: 1, typedName: "db" });
  });
});

describe("isValidBackupName", () => {
  it.each(["backup-2026-01-01.gz", "dump 1.sql.gz", "a:b@c"])("accepts %s", (v) => expect(isValidBackupName(v)).toBe(true));
  it.each(["", ".", "..", "a/b", "a\\b", "x\u0000y", "x".repeat(201)])("rejects %j", (v) => expect(isValidBackupName(v)).toBe(false));
});

describe("small helpers", () => {
  it("diskPercent is unit-agnostic and safe", () => {
    expect(diskPercent(50, 200)).toBe(25);
    expect(diskPercent(1, 0)).toBeUndefined();
    expect(diskPercent(undefined, 10)).toBeUndefined();
    expect(diskPercent(-1, 10)).toBeUndefined();
  });
  it("formatBytes scales units and rejects garbage", () => {
    expect(formatBytes(0)).toContain("بایت");
    expect(formatBytes(1536)).toContain("کیلوبایت");
    expect(formatBytes(5 * 1024 ** 3)).toContain("گیگابایت");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });
  it("isSafeHttpUrl allows only http(s)", () => {
    expect(isSafeHttpUrl("https://files.example.test/x?sig=1")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,x")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
  it("engineMeta knows the nine engines and falls back for others", () => {
    for (const e of ["mysql", "mariadb", "postgres", "mssql", "mongodb", "redis", "elasticsearch", "rabbitmq", "clickhouse"]) {
      expect(engineMeta(e).label).not.toBe("");
    }
    expect(engineMeta("cassandra").label).toBe("cassandra");
    expect(engineMeta(undefined).label).toBe("");
  });
});
