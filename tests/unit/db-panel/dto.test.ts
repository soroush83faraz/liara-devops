import { describe, expect, it } from "vitest";
import { databaseRef, DatabaseDetailResponseSchema, redactDatabase } from "../../../lib/liara";
import { buildConnectionDto } from "../../../lib/service/db/connection";
import { toBackupDtos, toOverviewDto } from "../../../lib/service/db/dto";

const SECRET = "SYNTH-root-pw-9f8e7d6c5b4a";

// Synthetic payload shaped like GET /v1/databases/{id}; it deliberately carries a clear-text password.
const raw = {
  database: {
    _id: "64a000000000000000000001",
    type: "postgres",
    planID: "small-g2",
    bundlePlanID: "bundle-1",
    status: "RUNNING",
    scale: 1,
    hostname: "synthetic-db",
    publicNetwork: true,
    version: "16",
    volumeSize: 5,
    created_at: "2026-01-02T03:04:05.000Z",
    dbName: "synth",
    node: { _id: "n1", host: "node-1.example.test" },
    port: 30001,
    internalPort: 5432,
    hourlyPrice: 120,
    username: "root",
    root_password: SECRET,
    metaData: { standaloneReplicaSet: false, privateNetwork: true },
    network: { _id: "net1", name: "prod" },
  },
};

describe("db DTOs never leak the password", () => {
  const detail = DatabaseDetailResponseSchema.parse(raw).database;

  it("the credential-free schema drops root_password at parse time", () => {
    expect(JSON.stringify(detail)).not.toContain(SECRET);
    expect(JSON.stringify(detail)).not.toContain("root_password");
  });

  it("overview DTO: no password value, no password-like keys", () => {
    const dto = toOverviewDto(detail, { hostname: "synthetic-db" });
    const json = JSON.stringify(dto);
    expect(json).not.toContain(SECRET);
    expect(json).not.toMatch(/root_password/i);
    // redactDatabase removes any password/secret/token-looking key: nothing may change if there are none.
    expect(redactDatabase(dto)).toEqual(dto);
  });

  it("connection DTO: only the placeholder, no real password, no password-like keys", () => {
    const dto = buildConnectionDto(detail);
    const json = JSON.stringify(dto);
    expect(json).not.toContain(SECRET);
    expect(json).not.toMatch(/root_password/i);
    expect(json).toContain("<PASSWORD>");
    expect(redactDatabase(dto)).toEqual(dto);
  });

  it("even a hostile object with a password field cannot pass through the builders", () => {
    const hostile = { ...detail, root_password: SECRET, password: SECRET } as typeof detail;
    expect(JSON.stringify(buildConnectionDto(hostile))).not.toContain(SECRET);
    expect(JSON.stringify(toOverviewDto(hostile, { hostname: "synthetic-db" }))).not.toContain(SECRET);
  });
});

describe("toOverviewDto", () => {
  const detail = DatabaseDetailResponseSchema.parse(raw).database;

  it("maps facts and status", () => {
    const dto = toOverviewDto(detail, { hostname: "synthetic-db" });
    expect(dto).toMatchObject({
      hostname: "synthetic-db",
      engine: "postgres",
      version: "16",
      planID: "small-g2",
      uiStatus: "running",
      volumeSizeGb: 5,
      hourlyPrice: 120,
      publicNetwork: true,
      network: { id: "net1", name: "prod" },
    });
  });

  it("scale 0 is stopped regardless of the raw status", () => {
    expect(toOverviewDto({ ...detail, scale: 0 }, { hostname: "h" }).uiStatus).toBe("stopped");
  });

  it("falls back to list summary values and a looked-up network name", () => {
    const sparse = DatabaseDetailResponseSchema.parse({ database: { hostname: "h", network: { _id: "n9" } } }).database;
    const dto = toOverviewDto(sparse, {
      hostname: "h",
      summary: { type: "Redis", status: "RUNNING", scale: 1, planID: "p1", publicNetwork: false },
      networkName: "from-list",
    });
    expect(dto).toMatchObject({ engine: "redis", planID: "p1", publicNetwork: false, uiStatus: "running", network: { id: "n9" } });
    expect(toOverviewDto({ ...sparse, network: undefined }, { hostname: "h", networkName: "from-list" }).network).toEqual({ name: "from-list" });
  });

  it("no network at all -> null", () => {
    const sparse = DatabaseDetailResponseSchema.parse({ database: { hostname: "h" } }).database;
    expect(toOverviewDto(sparse, { hostname: "h" }).network).toBeNull();
  });
});

describe("toBackupDtos", () => {
  it("sorts newest first, drops nameless entries and keeps only safe fields", () => {
    const out = toBackupDtos([
      { name: "old", lastModified: "2026-01-01T00:00:00Z", etag: "x", size: 10 },
      { name: "new", lastModified: "2026-02-01T00:00:00Z", etag: "y", size: 20 },
      { lastModified: "2026-03-01T00:00:00Z", size: 1 },
    ]);
    expect(out.map((b) => b.name)).toEqual(["new", "old"]);
    expect(out[0]).toEqual({ name: "new", size: 20, lastModified: "2026-02-01T00:00:00Z" });
  });
});

describe("databaseRef", () => {
  it("prefers _id", () => {
    expect(databaseRef({ _id: "a", id: "b", DBId: "c" })).toBe("a");
  });
});
