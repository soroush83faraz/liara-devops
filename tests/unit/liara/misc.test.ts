import { describe, expect, it } from "vitest";
import {
  addDomain, checkDomain, createDisk, createDiskBackup, createNetwork, deleteDisk, disableSsl, getBilling, getDiskBackupLink,
  getMe, latestUsage, listDisks, listDiskBackups, listDomains, listNetworks, normalizeSeries, provisionSsl, removeDomain,
  resizeDisk, setDomainRedirect, getAppMetricSeries, getAppMetricsSummary,
} from "../../../lib/liara";
import domainsFx from "../../fixtures/liara/domains.synthetic.json";
import checkFx from "../../fixtures/liara/domain-check.synthetic.json";
import appDetailFx from "../../fixtures/liara/app-detail.synthetic.json";
import disksFx from "../../fixtures/liara/disks.synthetic.json";
import backupsFx from "../../fixtures/liara/backups.synthetic.json";
import networksFx from "../../fixtures/liara/networks.synthetic.json";
import seriesFx from "../../fixtures/liara/metrics-series.synthetic.json";
import summaryFx from "../../fixtures/liara/metrics-summary.synthetic.json";
import meFx from "../../fixtures/liara/me.synthetic.json";
import billingFx from "../../fixtures/liara/billing.synthetic.json";
import { routes } from "./helpers";

describe("domains", () => {
  it("list / add / check / ssl / redirect / remove", async () => {
    const { client, calls } = routes({
      "GET /v1/domains": { json: domainsFx },
      "POST /v1/domains": { status: 201, json: { domain: { _id: "d9" } } },
      "GET /v1/domains/d9/check": { json: checkFx },
      "POST /v1/domains/provision-ssl-certs": { json: { code: "OK" } },
      "POST /v1/domains/d9/set-redirect": {},
      "POST /v1/domains/d9/ssl/disable": { status: 204 },
      "DELETE /v1/domains/d9": {},
    });
    const list = await listDomains(client, "demo-shop");
    expect(list[0]).toMatchObject({ name: "shop.example.ir", certificatesStatus: "ACTIVE" });
    expect(calls[0].url.searchParams.get("project")).toBe("demo-shop");
    expect(await addDomain(client, "demo-shop", "new.example.ir")).toBe("d9");
    expect(calls[1].body).toEqual({ name: "new.example.ir", project: "demo-shop", type: "PROJECT" });
    const chk = await checkDomain(client, "d9");
    expect(chk).toMatchObject({ CNameRecord: "demo-shop.liara.run", verificationCode: "liara-verify-synthetic-123" });
    expect(await provisionSsl(client, "new.example.ir")).toBe("OK");
    await setDomainRedirect(client, "d9", "https://www.example.ir", 302);
    expect(calls[4].body).toEqual({ redirectStatus: 302, redirectTo: "https://www.example.ir" });
    await disableSsl(client, "d9");
    await removeDomain(client, "d9");
    expect(calls).toHaveLength(7);
  });

  it("maps 409 on duplicate domain and 404 on check", async () => {
    const r = routes({ "POST /v1/domains": { status: 409, json: { message: "exists" } } });
    await expect(addDomain(r.client, "a", "x.ir")).rejects.toMatchObject({ kind: "conflict" });
    await expect(checkDomain(r.client, "nope")).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("disks", () => {
  // Live 2026-10-23: the disk routes take the project `_id` ("a1" in the synthetic app detail), not the name; create works by name.
  it("list / create / resize / delete / backups: by project _id, create by name", async () => {
    const { client, calls } = routes({
      "GET /v1/projects/demo-shop": { json: appDetailFx },
      "GET /v1/projects/demo-shop/disks": { status: 500, json: { error: "Internal Server Error" } },
      "GET /v1/projects/a1/disks": { json: disksFx },
      "POST /v1/projects/demo-shop/disks": { status: 201 },
      "POST /v1/projects/a1/disks/data/resize": {},
      "DELETE /v1/projects/a1/disks/data": {},
      "GET /v1/projects/a1/disks/data/backups": { json: backupsFx },
      "POST /v1/projects/a1/disks/data/backups": {},
      "POST /v1/projects/a1/disks/data/backups/backup-1.tar.gz/download": { json: { link: "https://dl.example.invalid/x" } },
    });
    const res = await listDisks(client, "demo-shop");
    expect(res.disks[0].name).toBe("data");
    expect(res.mounts[0].mountedTo).toBe("/data");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v1/projects/demo-shop", "GET /v1/projects/a1/disks"]);
    await createDisk(client, "demo-shop", "data", 2);
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/projects/demo-shop/disks", body: { name: "data", size: "2" } });
    await resizeDisk(client, "demo-shop", "data", 5);
    await deleteDisk(client, "demo-shop", "data");
    expect((await listDiskBackups(client, "demo-shop", "data"))[0].size).toBe(2048);
    await createDiskBackup(client, "demo-shop", "data");
    expect(await getDiskBackupLink(client, "demo-shop", "data", "backup-1.tar.gz")).toBe("https://dl.example.invalid/x");
    // the project _id is read once for the whole sequence (cached per client)
    expect(calls.filter((c) => c.path === "/v1/projects/demo-shop")).toHaveLength(1);
    expect(calls.some((c) => c.method !== "POST" && c.path === "/v1/projects/demo-shop/disks")).toBe(false);
  });

  it("an empty mounts list parses (disk exists, no release mounts it) and the live disk shape keeps filebrowserUrl", async () => {
    const live = { disks: [{ name: "data", size: 1, updatedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", filebrowserUrl: "https://filebrowser-x.example.invalid" }], mounts: [] };
    const { client } = routes({ "GET /v1/projects/demo-shop": { json: appDetailFx }, "GET /v1/projects/a1/disks": { json: live } });
    const res = await listDisks(client, "demo-shop");
    expect(res.mounts).toEqual([]);
    expect(res.disks[0]).toMatchObject({ name: "data", size: 1, filebrowserUrl: "https://filebrowser-x.example.invalid" });
    expect(res.disks[0]._id).toBeUndefined();
  });

  it("surfaces a failed app lookup and never caches it", async () => {
    let n = 0;
    const { client, calls } = routes({
      "GET /v1/projects/demo-shop": () => (++n === 1 ? { status: 404, json: { message: "nope" } } : { json: appDetailFx }),
      "GET /v1/projects/a1/disks": { json: disksFx },
    });
    await expect(listDisks(client, "demo-shop")).rejects.toMatchObject({ kind: "not_found" });
    expect((await listDisks(client, "demo-shop")).disks).toHaveLength(1);
    expect(calls.filter((c) => c.path === "/v1/projects/demo-shop")).toHaveLength(2);
  });

  it("an app detail without _id makes the by-id routes fail loudly instead of calling the name route", async () => {
    const { client, calls } = routes({ "GET /v1/projects/demo-shop": { json: { project: { project_id: "demo-shop" } } } });
    await expect(listDisks(client, "demo-shop")).rejects.toMatchObject({ code: "project_id_missing" });
    expect(calls.map((c) => c.path)).toEqual(["/v1/projects/demo-shop"]);
  });

  it("createDisk surfaces not_enough_storage_space as validation", async () => {
    const r = routes({ "POST /v1/projects/a/disks": { status: 400, json: { statusCode: 400, message: "not_enough_storage_space" } } });
    await expect(createDisk(r.client, "a", "d", 1)).rejects.toMatchObject({ kind: "validation", code: "not_enough_storage_space" });
  });
});

describe("networks", () => {
  it("list and create (409 dup, no retry)", async () => {
    const { client, calls } = routes({ "GET /v1/networks": { json: networksFx }, "POST /v1/networks": { status: 409, json: {} } });
    expect((await listNetworks(client))[0]).toMatchObject({ _id: "n1", name: "main" });
    await expect(createNetwork(client, "main")).rejects.toMatchObject({ kind: "conflict" });
    expect(calls[1].body).toEqual({ networkName: "main" });
    await expect(createNetwork(client, "ab")).rejects.toMatchObject({ code: "invalid_argument" });
    expect(calls).toHaveLength(2);
  });
});

describe("metrics", () => {
  it("summary and series (+ normalisation drops non-numeric samples)", async () => {
    const { client, calls } = routes({
      "GET /v1/projects/demo-shop/metrics/summary": { json: summaryFx },
      "GET /v1/projects/demo-shop/metrics/cpu": { json: seriesFx },
      "GET /v1/projects/demo-shop/metrics/network-receive": { status: 500, json: {} },
    });
    const sum = await getAppMetricsSummary(client, "demo-shop");
    expect(latestUsage(sum.cpuUsage)).toEqual([{ applet: "p1", value: 0.31 }]);
    expect(sum.disksUsage[0].name).toBe("data");
    const series = await getAppMetricSeries(client, "demo-shop", "cpu", 3600);
    expect(calls[1].url.searchParams.get("since")).toBe("3600");
    const [s] = normalizeSeries(series);
    expect(s.points).toEqual([{ t: 1767430000, v: 0.1 }, { t: 1767430060, v: 0.25 }]);
    await expect(getAppMetricSeries(client, "demo-shop", "network-receive", 1)).rejects.toMatchObject({ kind: "server" });
  });
});

describe("account", () => {
  it("getMe and getBilling", async () => {
    const { client } = routes({ "GET /v1/me": { json: meFx }, "GET /v1/billing": { json: billingFx } });
    const me = await getMe(client);
    expect(me.user?.email).toBe("user@example.invalid");
    expect(me.plans?.projects).toBeDefined();
    expect((await getBilling(client)).user?.balance).toBe(123456.5);
  });
  it("getMe 401", async () => {
    const { client } = routes({ "GET /v1/me": { status: 401, json: { message: "Unauthorized" } } });
    await expect(getMe(client)).rejects.toMatchObject({ kind: "auth", status: 401 });
  });
});
