import { describe, expect, it } from "vitest";
import {
  createApp, deleteApp, getApp, getAppEvents, listApplets, listApps, listReleases, getRelease, cancelRelease,
  restartApp, resizeApp, scaleApp, setAppToggle, startApp, stopApp, updateAppPort, isLiaraError,
} from "../../../lib/liara";
import appsFx from "../../fixtures/liara/apps-list.synthetic.json";
import detailFx from "../../fixtures/liara/app-detail.synthetic.json";
import appletsFx from "../../fixtures/liara/applets.synthetic.json";
import releasesFx from "../../fixtures/liara/releases.synthetic.json";
import releaseFx from "../../fixtures/liara/release-detail.synthetic.json";
import eventsFx from "../../fixtures/liara/events.synthetic.json";
import { routes } from "./helpers";

describe("apps", () => {
  it("listApps / getApp parse the fixtures (network included)", async () => {
    const { client } = routes({ "GET /v1/projects": { json: appsFx }, "GET /v1/projects/demo-shop": { json: detailFx } });
    const apps = await listApps(client);
    expect(apps.map((a) => a.project_id)).toEqual(["demo-shop", "blog"]);
    expect(apps[0].network?.name).toBe("main");
    const app = await getApp(client, "demo-shop");
    expect(app.envs).toHaveLength(3);
    expect(app.node?.IP).toBe("203.0.113.10");
    expect(app.hourlyPrice).toBe(120.5);
  });

  it("tolerates unknown fields and wrongly-typed fields", async () => {
    const { client } = routes({ "GET /v1/projects": { json: { projects: [{ project_id: "x", scale: "one", brandNew: { a: 1 } }] } } });
    const [a] = await listApps(client);
    expect(a.project_id).toBe("x");
    expect(a.scale).toBeUndefined();
    expect(a.brandNew).toEqual({ a: 1 });
  });

  it("getApp maps 401/404 and encodes the name", async () => {
    const r404 = routes({});
    await expect(getApp(r404.client, "a/b")).rejects.toMatchObject({ kind: "not_found", status: 404 });
    expect(r404.calls[0].path).toBe("/v1/projects/a%2Fb");
    const r401 = routes({ "GET /v1/projects": { status: 401, json: { message: "Unauthorized" } } });
    await expect(listApps(r401.client)).rejects.toMatchObject({ kind: "auth" });
  });

  it("createApp posts the body, validates, and refetches (empty 200)", async () => {
    const { client, calls } = routes({ "POST /v1/projects": { status: 200 }, "GET /v1/projects/demo-shop": { json: detailFx } });
    const app = await createApp(client, { name: "demo-shop", planID: "iran-g2-small", platform: "node", bundlePlanID: "standard", network: "n1" });
    expect(app?.project_id).toBe("demo-shop");
    expect(calls[0].body).toEqual({ name: "demo-shop", planID: "iran-g2-small", platform: "node", bundlePlanID: "standard", network: "n1" });
    await expect(createApp(client, { name: "x", planID: "p", platform: "cobol" as never, bundlePlanID: "b" })).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(createApp(client, { name: "x", planID: "free", platform: "node", bundlePlanID: "standard" })).rejects.toMatchObject({ code: "invalid_argument" });
    expect(calls).toHaveLength(2); // invalid calls sent nothing
  });

  it("createApp returns null when the refetch fails after a successful create, and surfaces 409/402/403", async () => {
    const ok = routes({ "POST /v1/projects": { status: 200 } });
    await expect(createApp(ok.client, { name: "n", planID: "p", platform: "node", bundlePlanID: "b" })).resolves.toBeNull();
    for (const [status, kind] of [[409, "conflict"], [402, "payment"], [403, "forbidden"]] as const) {
      const r = routes({ "POST /v1/projects": { status, json: { statusCode: status, message: "x" } } });
      const err = await createApp(r.client, { name: "n", planID: "p", platform: "node", bundlePlanID: "b" }).catch((e) => e);
      expect(isLiaraError(err) && err.kind).toBe(kind);
      expect(r.calls).toHaveLength(1);
    }
  });

  it("mutation endpoints use the documented paths and bodies", async () => {
    const { client, calls } = routes({
      "DELETE /v1/projects/demo-shop": { status: 204 },
      "POST /v1/projects/demo-shop/actions/restart": {},
      "POST /v1/projects/demo-shop/actions/scale": {},
      "POST /v1/projects/demo-shop/resize": {},
      "POST /v1/projects/update-port": {},
      "POST /v1/projects/demo-shop/zero-downtime/enable": {},
      "POST /v1/projects/demo-shop/fixed-ip/enable": { json: { IP: "203.0.113.99" } },
      "POST /v1/projects/demo-shop/read-only/disable": {},
      "POST /v1/projects/demo-shop/default-subdomain/disable": {},
    });
    await restartApp(client, "demo-shop");
    await startApp(client, "demo-shop");
    await stopApp(client, "demo-shop");
    await scaleApp(client, "demo-shop", 1);
    await resizeApp(client, "demo-shop", "iran-g2-big");
    await updateAppPort(client, "demo-shop", 8080);
    await setAppToggle(client, "demo-shop", "zero-downtime", true);
    expect(await setAppToggle(client, "demo-shop", "fixed-ip", true)).toEqual({ IP: "203.0.113.99" });
    await setAppToggle(client, "demo-shop", "read-only", false);
    await setAppToggle(client, "demo-shop", "default-subdomain", false);
    await deleteApp(client, "demo-shop");
    const bodies = calls.map((c) => c.body);
    expect(bodies[1]).toEqual({ scale: 1 });
    expect(bodies[2]).toEqual({ scale: 0 });
    expect(bodies[4]).toEqual({ planID: "iran-g2-big" });
    expect(bodies[5]).toEqual({ project: "demo-shop", port: 8080 });
    await expect(updateAppPort(client, "demo-shop", 70000)).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("surfaces 409 (busy) on restart without retrying", async () => {
    const r = routes({ "POST /v1/projects/a/actions/restart": { status: 409, json: { message: "busy" } } });
    await expect(restartApp(r.client, "a")).rejects.toMatchObject({ kind: "conflict" });
    expect(r.calls).toHaveLength(1);
  });

  it("applets and events", async () => {
    const { client, calls } = routes({
      "GET /v1/projects/demo-shop/applets": { json: appletsFx },
      "GET /v1/projects/demo-shop/events": { json: eventsFx },
    });
    const applets = await listApplets(client, "demo-shop");
    expect(applets[0]).toMatchObject({ state: "Running", release: { tag: "v2" } });
    const events = await getAppEvents(client, "demo-shop", { search: "OOM", start: 10, end: 20 });
    expect(events[0].message).toContain("OOMKilled");
    expect(calls[1].url.searchParams.get("search")).toBe("OOM");
    expect(calls[1].url.searchParams.get("start")).toBe("10");
  });
});

describe("releases", () => {
  it("list (paging params), get [CLI], cancel [CLI]", async () => {
    const { client, calls } = routes({
      "GET /v1/projects/demo-shop/releases": { json: releasesFx },
      "GET /v1/releases/r1": { json: releaseFx },
      "POST /v2/releases/r1/cancel": {},
    });
    const page = await listReleases(client, "demo-shop", { page: 2, count: 5 });
    expect(page.releases.map((r) => r.state)).toEqual(["READY", "FAILED"]);
    expect(page.currentRelease).toBe("r2");
    expect(calls[0].url.searchParams.get("page")).toBe("2");
    expect(calls[0].url.searchParams.get("count")).toBe("5");
    const rel = await getRelease(client, "r1");
    expect(rel).toMatchObject({ state: "FAILED", failReason: "disk_not_found data" });
    await cancelRelease(client, "r1");
    expect(calls[2].method).toBe("POST");
  });

  it("cancel is not retried on 5xx, get is", async () => {
    const r = routes({ "POST /v2/releases/r1/cancel": { status: 500, json: {} }, "GET /v1/releases/r1": { status: 500, json: {} } });
    await expect(cancelRelease(r.client, "r1")).rejects.toMatchObject({ kind: "server" });
    expect(r.calls).toHaveLength(1);
    await expect(getRelease(r.client, "r1")).rejects.toMatchObject({ kind: "server" });
    expect(r.calls.length).toBe(1 + 3);
  });
});
