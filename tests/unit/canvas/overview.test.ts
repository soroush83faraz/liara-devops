// SYNTHETIC inputs: hand-written to exercise the code, NOT recorded from Liara.
import { describe, expect, it } from "vitest";
import { AppDetailSchema, AppSummarySchema, DatabaseDetailSchema, DatabaseSummarySchema, NetworksResponseSchema } from "@/lib/liara/schemas";
import { appStatus, buildOverview, dbStatus, deriveEdges, matchesHost } from "@/lib/canvas/overview";

const app = (o: Record<string, unknown>) => AppSummarySchema.parse(o);
const appDetail = (o: Record<string, unknown>) => AppDetailSchema.parse(o);
const db = (o: Record<string, unknown>) => DatabaseSummarySchema.parse(o);
const dbDetail = (o: Record<string, unknown>) => DatabaseDetailSchema.parse(o);

describe("status mapping", () => {
  it("maps known states and never guesses unknown ones", () => {
    expect(appStatus({ status: "RUNNING", scale: 1 })).toBe("running");
    expect(appStatus({ status: "Deploying", scale: 1 })).toBe("building");
    expect(appStatus({ status: "something-new", scale: 1 })).toBe("unknown");
    expect(appStatus({ status: undefined, scale: undefined })).toBe("unknown");
  });
  it("treats scale 0 as stopped", () => {
    expect(appStatus({ status: "RUNNING", scale: 0 })).toBe("stopped");
    expect(dbStatus({ status: "RUNNING", scale: 0 })).toBe("stopped");
    expect(dbStatus({ status: "RUNNING", scale: 1 })).toBe("running");
  });
});

describe("matchesHost", () => {
  it("matches whole tokens only", () => {
    expect(matchesHost("postgres://u:p@shop-db:5432/x", "shop-db", 5432)).toEqual({ match: true, withPort: true });
    expect(matchesHost("shop-db", "shop-db").match).toBe(true);
    expect(matchesHost("shop-db2", "shop-db").match).toBe(false);
    expect(matchesHost("my-shop-db", "shop-db").match).toBe(false);
    expect(matchesHost("shop-db.example.com", "shop-db").match).toBe(false);
    expect(matchesHost("shop-db:6000", "shop-db", 5432)).toEqual({ match: true, withPort: false });
  });
  it("ignores very short hostnames and empty values", () => {
    expect(matchesHost("db", "db").match).toBe(false);
    expect(matchesHost("", "shop-db").match).toBe(false);
  });
});

describe("deriveEdges", () => {
  const dbs = [{ id: "db:shop-db", networkId: "n1", hostname: "shop-db", internalPort: 5432 }];
  it("emits an edge with the KEY only when a value contains the hostname in the same network", () => {
    const edges = deriveEdges([{ id: "web", networkId: "n1", envs: [{ key: "DATABASE_URL", value: "postgres://u:secret@shop-db:5432/x" }] }], dbs);
    expect(edges).toEqual([{ from: "web", to: "db:shop-db", viaKey: "DATABASE_URL" }]);
    expect(JSON.stringify(edges)).not.toContain("secret");
  });
  it("prefers the key whose value has host:port", () => {
    const edges = deriveEdges(
      [{ id: "web", networkId: "n1", envs: [{ key: "DB_HOST", value: "shop-db" }, { key: "DB_ADDR", value: "shop-db:5432" }] }],
      dbs,
    );
    expect(edges[0].viaKey).toBe("DB_ADDR");
  });
  it("emits nothing when no value mentions the host", () => {
    expect(deriveEdges([{ id: "web", networkId: "n1", envs: [{ key: "A", value: "other" }] }], dbs)).toEqual([]);
  });
  it("emits nothing across different networks or without a network", () => {
    const envs = [{ key: "DB_HOST", value: "shop-db" }];
    expect(deriveEdges([{ id: "web", networkId: "n2", envs }], dbs)).toEqual([]);
    expect(deriveEdges([{ id: "web", networkId: null, envs }], [{ ...dbs[0], networkId: null }])).toEqual([]);
  });
});

describe("buildOverview", () => {
  const apps = [
    app({ project_id: "web", type: "next", status: "RUNNING", scale: 1, planID: "small-g2", network: { _id: "n1", name: "shop" } }),
    app({ project_id: "solo", type: "node", status: "weird", scale: 1 }),
    app({ project_id: "stopped-app", type: "static", status: "RUNNING", scale: 0 }),
    app({ _id: "no-name-field" }), // falls back to _id when project_id is missing
    app({}), // nothing to name it by: skipped
  ];
  const databases = [db({ _id: "d1", hostname: "shop-db", type: "postgres", status: "RUNNING", scale: 1, internalPort: 5432, planID: "p" })];

  it("normalises services, networks and derives edges without leaking env values", () => {
    const o = buildOverview({
      apps,
      appDetails: new Map([
        ["web", appDetail({ project_id: "web", defaultSubdomain: true, hourlyPrice: 12, envs: [{ key: "DATABASE_URL", value: "postgres://root:TOPSECRET@shop-db:5432/app" }] })],
        ["solo", appDetail({ project_id: "solo", defaultSubdomain: false, envs: [] })],
        ["stopped-app", appDetail({ project_id: "stopped-app", envs: [] })],
        ["no-name-field", appDetail({ envs: [] })],
      ]),
      databases,
      dbDetails: new Map([["d1", dbDetail({ hostname: "shop-db", root_password: "TOPSECRET", network: { _id: "n1", name: "shop" } })]]),
      networks: NetworksResponseSchema.parse({ networks: [{ _id: "n1", name: "shop" }] }).networks,
      balance: 1000,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(o.networks).toEqual([{ id: "n1", name: "shop" }]);
    expect(o.services.map((s) => s.id)).toEqual(["web", "solo", "stopped-app", "no-name-field", "db:shop-db"]);
    const byId = Object.fromEntries(o.services.map((s) => [s.id, s]));
    expect(byId.web).toMatchObject({ kind: "app", networkId: "n1", status: "running", hourlyPriceToman: 12, url: "https://web.liara.run" });
    expect(byId.solo).toMatchObject({ status: "unknown", networkId: null, url: undefined });
    expect(byId["stopped-app"].status).toBe("stopped");
    expect(byId["db:shop-db"]).toMatchObject({ kind: "db", platformOrEngine: "postgres", networkId: "n1", ref: "d1" });
    expect(o.edges).toEqual([{ from: "web", to: "db:shop-db", viaKey: "DATABASE_URL" }]);
    expect(o.balance).toBe(1000);
    expect(o.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(JSON.stringify(o)).not.toContain("TOPSECRET");
    expect(o.edgesPartial).toBeUndefined();
  });

  it("flags edgesPartial when a detail call failed or was skipped, and keeps services", () => {
    const o = buildOverview({
      apps,
      appDetails: new Map([["web", null]]),
      databases,
      dbDetails: new Map(),
      networks: null,
      errors: { networks: "failed" },
    });
    expect(o.edgesPartial).toBe(true);
    expect(o.errors.networks).toBe("failed");
    expect(o.edges).toEqual([]);
    // networks fall back to the refs found on the apps
    expect(o.networks).toEqual([{ id: "n1", name: "shop" }]);
    expect(o.services.length).toBeGreaterThanOrEqual(4);
  });

  it("tolerates a failed database list", () => {
    const o = buildOverview({ apps, appDetails: new Map(), databases: [], dbDetails: new Map(), networks: [], errors: { databases: "failed" } });
    expect(o.services.every((s) => s.kind === "app")).toBe(true);
    expect(o.errors.databases).toBe("failed");
  });
});
