import { describe, expect, it } from "vitest";
import {
  createDatabase, createDatabaseBackup, databaseRef, deleteDatabase, getDatabase, getDatabaseBackupLink, getDatabaseCredentials,
  getDatabaseEvents, getDatabaseMetricSeries, getDatabaseMetricsSummary, listDatabaseBackups, listDatabases, redactDatabase,
  resizeDatabase, scaleDatabase, setDatabaseControlPanel, setDatabasePublicNetwork, updateDatabaseSettings,
} from "../../../lib/liara";
import listFx from "../../fixtures/liara/databases-list.synthetic.json";
import detailFx from "../../fixtures/liara/database-detail.synthetic.json";
import backupsFx from "../../fixtures/liara/backups.synthetic.json";
import seriesFx from "../../fixtures/liara/metrics-series.synthetic.json";
import summaryFx from "../../fixtures/liara/metrics-summary.synthetic.json";
import eventsFx from "../../fixtures/liara/events.synthetic.json";
import { routes } from "./helpers";

const PASSWORD = "SYNTHETIC-NOT-A-REAL-PASSWORD";

describe("databases: read", () => {
  it("lists and resolves the id used in action paths ([CLI] _id first)", async () => {
    const { client } = routes({ "GET /v1/databases": { json: listFx } });
    const [db] = await listDatabases(client);
    expect(db).toMatchObject({ hostname: "shop-db", type: "postgres", status: "RUNNING" });
    expect(databaseRef(db)).toBe("db1");
    expect(databaseRef({ DBId: "DB-9" })).toBe("DB-9");
  });

  it("getDatabase has NO password anywhere; credentials are an explicit opt-in", async () => {
    const { client } = routes({ "GET /v1/databases/db1": { json: detailFx } });
    const db = await getDatabase(client, "db1");
    expect(db).toMatchObject({ hostname: "shop-db", version: "16", username: "root", node: { host: "198.51.100.7" } });
    expect(JSON.stringify(db)).not.toContain(PASSWORD);
    expect("root_password" in db).toBe(false);
    // @ts-expect-error root_password must not exist on the default type
    void db.root_password;

    const creds = await getDatabaseCredentials(client, "db1");
    expect(creds).toMatchObject({ password: PASSWORD, username: "root", hostname: "shop-db", internalPort: 5432, port: 31337 });
  });

  it("redactDatabase strips password-like keys deeply without mutating the input", () => {
    const raw = { ...detailFx.database, nested: { api_key: "k", ok: 1 }, list: [{ secretToken: "t", n: 1 }] };
    const safe = redactDatabase(raw);
    expect(JSON.stringify(safe)).not.toContain(PASSWORD);
    expect(safe).toMatchObject({ hostname: "shop-db", nested: { ok: 1 }, list: [{ n: 1 }] });
    expect(raw.root_password).toBe(PASSWORD);
  });

  it("maps 404 on unknown id", async () => {
    const { client } = routes({});
    await expect(getDatabase(client, "zzz")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("metrics, summary, events (hostname path), backups", async () => {
    const { client, calls } = routes({
      "GET /v1/databases/db1/metrics/summary": { json: summaryFx },
      "GET /v1/databases/db1/metrics/memory": { json: seriesFx },
      "GET /v1/databases/shop-db/events": { json: eventsFx },
      "GET /v1/databases/db1/backups": { json: backupsFx },
      "POST /v1/databases/db1/backups": {},
      "POST /v1/databases/db1/backups/backup-1.tar.gz/download": { json: { link: "https://dl.example.invalid/b" } },
    });
    expect((await getDatabaseMetricsSummary(client, "db1")).cpuUsage[0].applet).toBe("p1");
    expect((await getDatabaseMetricSeries(client, "db1", "memory", 60)).result).toHaveLength(1);
    expect((await getDatabaseEvents(client, "shop-db", { search: "x" }))[0].message).toContain("OOMKilled");
    expect(await listDatabaseBackups(client, "db1")).toHaveLength(1);
    await createDatabaseBackup(client, "db1");
    expect(await getDatabaseBackupLink(client, "db1", "backup-1.tar.gz")).toContain("dl.example.invalid");
    expect(calls[1].url.searchParams.get("since")).toBe("60");
  });
});

describe("databases: mutations", () => {
  const input = { hostname: "shop-db", type: "postgres", version: "16", planID: "iran-g2-small", bundlePlanID: "standard", publicNetwork: false, network: "n1" } as const;

  it("create posts the CLI body and returns the id; 409/403 map; never retried", async () => {
    const ok = routes({ "POST /v1/databases": { json: { databaseID: "db7" } } });
    expect(await createDatabase(ok.client, input)).toBe("db7");
    expect(ok.calls[0].body).toEqual(input);

    const dup = routes({ "POST /v1/databases": { status: 409, json: {} } });
    await expect(createDatabase(dup.client, input)).rejects.toMatchObject({ kind: "conflict" });
    const free = routes({ "POST /v1/databases": { status: 403, json: { data: { code: "free_plan_count" } } } });
    await expect(createDatabase(free.client, input)).rejects.toMatchObject({ kind: "forbidden", code: "free_plan_count" });
    const down = routes({ "POST /v1/databases": { status: 502, json: {} } });
    await expect(createDatabase(down.client, input)).rejects.toMatchObject({ kind: "server" });
    expect(down.calls).toHaveLength(1);

    await expect(createDatabase(ok.client, { ...input, type: "oracle" as never })).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("delete / scale / resize / settings / public network / control panel", async () => {
    const { client, calls } = routes({
      "DELETE /v1/databases/db1": {},
      "POST /v1/databases/db1/actions/scale": {},
      "POST /v1/databases/db1/resize": {},
      "PATCH /v1/databases/db1/settings": {},
      "PATCH /v1/databases/db1/public-network/enable": {},
      "PATCH /v1/databases/db1/public-network/disable": {},
      "POST /v1/databases/db1/control-panel/enable": { json: { controlPanelID: "cp1" } },
    });
    await deleteDatabase(client, "db1");
    await scaleDatabase(client, "db1", 0);
    await resizeDatabase(client, "db1", "iran-g2-big", true);
    await updateDatabaseSettings(client, "db1", "mysql", { maxConnections: 200 });
    await setDatabasePublicNetwork(client, "db1", true);
    await setDatabasePublicNetwork(client, "db1", false);
    expect(await setDatabaseControlPanel(client, "db1", true)).toBe("cp1");
    expect(calls.map((c) => c.method)).toEqual(["DELETE", "POST", "POST", "PATCH", "PATCH", "PATCH", "POST"]);
    expect(calls[1].body).toEqual({ scale: 0 });
    expect(calls[2].body).toEqual({ planID: "iran-g2-big", disk: true });
    expect(calls[3].body).toEqual({ type: "mysql", options: { maxConnections: 200 } });
  });
});
