import { describe, expect, it } from "vitest";
import type { OverviewService } from "@/lib/canvas/types";
import { clearLogRedactors } from "@/lib/service/app-read/known-secrets";
import { MAX_OBSERVED_SERVICES } from "@/lib/observability/types";
import { collectErrors, collectObservability, mapPool, parseNetworkParam, selectServices } from "@/lib/observability/aggregate";
import { parseMetricRange } from "@/lib/service/app-read/metrics-range";
import { clientFor, type Call, type FakeReply } from "../liara/helpers";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const nowSec = Math.floor(NOW / 1000);

const app = (name: string, extra: Partial<OverviewService> = {}): OverviewService => ({
  id: name, kind: "app", name, networkId: "n1", platformOrEngine: "node", status: "running", planId: "iran-g2-small", ...extra,
});
const db = (host: string, extra: Partial<OverviewService> = {}): OverviewService => ({
  id: `db:${host}`, kind: "db", name: host, ref: `ref-${host}`, networkId: "n1", platformOrEngine: "postgres", status: "running", planId: "iran-g2-small", ...extra,
});
const overviewOf = (services: OverviewService[]) => ({ services, networks: [{ id: "n1", name: "main" }, { id: "n2", name: "other" }] });

const ME = {
  user: { _id: "u" },
  plans: {
    projects: { "iran-g2-small": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5, price: 100 } },
    databases: { "iran-g2-small": { available: true, region: "iran", RAM: { amount: 2 }, CPU: { amount: 2 }, volume: 10, price: 1, supports: ["postgres"] } },
  },
};

const series = (v: string) => ({ end: nowSec, result: [{ applet: "p1", values: [[nowSec - 120, v], [nowSec - 60, v], [nowSec, v]] }] });
const summary = { cpuUsage: [{ applet: "p1", value: [nowSec, "0.4"] }], memoryUsage: [{ applet: "p1", value: [nowSec, "1048576"] }], disksUsage: [] };
const release = (id: string, ago: number) => ({ _id: id, state: "READY", tag: id, createdAt: new Date(NOW - ago * 1000).toISOString() });

/** Handler for a healthy account; `down` names get HTTP 500 on every metrics call. */
function healthy(opts: { down?: string[]; releasesFail?: string[]; onCall?: (c: Call) => void } = {}) {
  return (c: Call): FakeReply => {
    opts.onCall?.(c);
    if (c.path === "/v1/me") return { json: ME };
    let m = /^\/v1\/projects\/([^/]+)\/metrics\/(.+)$/.exec(c.path) ?? /^\/v1\/databases\/([^/]+)\/metrics\/(.+)$/.exec(c.path);
    if (m) {
      if (opts.down?.includes(decodeURIComponent(m[1]!))) return { status: 500, json: { message: "boom" } };
      return { json: m[2] === "summary" ? summary : series("0.25") };
    }
    m = /^\/v1\/projects\/([^/]+)\/releases$/.exec(c.path);
    if (m) {
      if (opts.releasesFail?.includes(m[1]!)) return { status: 500, json: { message: "boom" } };
      return { json: { total: 2, currentRelease: "r2", releases: [release("r1", 86_400), release("r2", 3_600)] } };
    }
    return { status: 404, json: { message: "not found" } };
  };
}

describe("parameter parsing", () => {
  it("range: default, valid values, unknown values", () => {
    expect(parseMetricRange(null)).toBe("1h");
    expect(parseMetricRange("")).toBe("1h");
    for (const r of ["15m", "1h", "6h", "24h"]) expect(parseMetricRange(r)).toBe(r);
    expect(parseMetricRange("7d")).toBeNull();
    expect(parseMetricRange("1H")).toBeNull();
  });
  it("network: none, id, invalid", () => {
    expect(parseNetworkParam(null)).toBeNull();
    expect(parseNetworkParam("")).toBeNull();
    expect(parseNetworkParam("n-1_a")).toBe("n-1_a");
    expect(parseNetworkParam("a b")).toBe("invalid");
    expect(parseNetworkParam("../x")).toBe("invalid");
    expect(parseNetworkParam("x".repeat(65))).toBe("invalid");
  });
});

describe("selectServices", () => {
  it("filters by network, puts problems first, apps before databases, then by name", () => {
    const o = overviewOf([db("zdb"), app("b"), app("a", { networkId: "n2" }), app("sick", { status: "failed" }), app("c")]);
    expect(selectServices(o, null).selected.map((s) => s.id)).toEqual(["sick", "a", "b", "c", "db:zdb"]);
    const f = selectServices(o, "n1");
    expect(f.selected.map((s) => s.id)).toEqual(["sick", "b", "c", "db:zdb"]);
    expect(f.total).toBe(4);
    expect(selectServices(o, "nope")).toEqual({ selected: [], total: 0 });
  });
  it("caps and reports the total before the cap", () => {
    const many = Array.from({ length: 15 }, (_, i) => app(`app-${String(i).padStart(2, "0")}`));
    const r = selectServices(overviewOf(many), null);
    expect(r.selected).toHaveLength(MAX_OBSERVED_SERVICES);
    expect(r.total).toBe(15);
  });
});

describe("mapPool", () => {
  it("keeps order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});

describe("collectObservability", () => {
  it("normalises an app and a database, with limits, current value and release times", async () => {
    const { client } = clientFor(healthy());
    const dto = await collectObservability({ liara: client, overview: overviewOf([app("shop"), db("shop-db")]), range: "1h", network: null, now: NOW });
    expect(dto.unitsVerified).toBe(false);
    expect(dto.range).toBe("1h");
    expect(dto.since).toBe(nowSec - 3600);
    expect(dto.truncated).toEqual({ shown: 2, total: 2 });
    expect(dto.networks.map((n) => n.id)).toEqual(["n1", "n2"]);
    const shop = dto.services.find((s) => s.id === "shop")!;
    if (shop.metrics.unavailable) throw new Error("expected metrics");
    expect(shop.metrics.unitsVerified).toBe(false);
    expect(shop.metrics.limits).toEqual({ ramGb: 1, cpu: 1 });
    expect(shop.metrics.current?.cpu).toEqual([{ applet: "p1", value: 0.4 }]);
    expect(shop.metrics.cpu.unavailable).toBe(false);
    expect(shop.releases.map((r) => r.id)).toEqual(["r2", "r1"]); // newest first
    expect(shop.lastReleaseAt).toBe(new Date(NOW - 3_600_000).toISOString());
    const database = dto.services.find((s) => s.id === "db:shop-db")!;
    if (database.metrics.unavailable) throw new Error("expected metrics");
    expect(database.metrics.limits).toEqual({ ramGb: 2, cpu: 2 });
    expect(database.releases).toEqual([]);
    expect(database.lastReleaseAt).toBeUndefined();
  });

  it("a failing service degrades alone; nothing is invented for it", async () => {
    const { client } = clientFor(healthy({ down: ["bad"] }));
    const dto = await collectObservability({ liara: client, overview: overviewOf([app("good"), app("bad")]), range: "15m", network: null, now: NOW });
    const bad = dto.services.find((s) => s.id === "bad")!;
    expect(bad.metrics).toEqual({ unavailable: true, reason: "request_failed", range: "15m" });
    const good = dto.services.find((s) => s.id === "good")!;
    expect(good.metrics.unavailable).toBeFalsy();
    // releases of the failing service are still real data
    expect(bad.releases).toHaveLength(2);
  });

  it("a failing releases call only drops the markers", async () => {
    const { client } = clientFor(healthy({ releasesFail: ["shop"] }));
    const dto = await collectObservability({ liara: client, overview: overviewOf([app("shop")]), range: "1h", network: null, now: NOW });
    const s = dto.services[0]!;
    expect(s.releases).toEqual([]);
    expect(s.releasesUnavailable).toBe(true);
    expect(s.metrics.unavailable).toBeFalsy();
  });

  it("an auth failure fails the whole response instead of marking every service unavailable", async () => {
    const { client } = clientFor((c) => (c.path.includes("/metrics/") ? { status: 401, json: { message: "no" } } : healthy()(c)));
    await expect(collectObservability({ liara: client, overview: overviewOf([app("a")]), range: "1h", network: null, now: NOW })).rejects.toMatchObject({ kind: "auth" });
  });

  it("filters by network", async () => {
    const { client } = clientFor(healthy());
    const o = overviewOf([app("in-n1"), app("in-n2", { networkId: "n2" }), db("db-n2", { networkId: "n2" })]);
    const dto = await collectObservability({ liara: client, overview: o, range: "1h", network: "n2", now: NOW });
    expect(dto.services.map((s) => s.id).sort()).toEqual(["db:db-n2", "in-n2"]);
    expect(dto.truncated).toEqual({ shown: 2, total: 2 });
  });

  it("truncates to 12 services and says so, without querying the rest", async () => {
    const seen = new Set<string>();
    const { client } = clientFor(healthy({ onCall: (c) => seen.add(c.path.split("/")[3] ?? "") }));
    const many = Array.from({ length: 15 }, (_, i) => app(`app-${String(i).padStart(2, "0")}`));
    const dto = await collectObservability({ liara: client, overview: overviewOf(many), range: "1h", network: null, now: NOW });
    expect(dto.services).toHaveLength(12);
    expect(dto.truncated).toEqual({ shown: 12, total: 15 });
    expect(seen.has("app-14")).toBe(false);
    expect(seen.has("app-00")).toBe(true);
  });

  it("empty account: no services, no Liara calls, explicit truncated field", async () => {
    const { client, calls } = clientFor(healthy());
    const dto = await collectObservability({ liara: client, overview: overviewOf([]), range: "6h", network: null, now: NOW });
    expect(dto.services).toEqual([]);
    expect(dto.truncated).toEqual({ shown: 0, total: 0 });
    expect(calls).toHaveLength(0);
  });

  it("never has more than 3 Liara requests in flight (the client cap)", async () => {
    let active = 0;
    let peak = 0;
    const inner = healthy();
    const { client } = clientFor(async (c) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return inner(c);
    });
    const many = Array.from({ length: 8 }, (_, i) => app(`app-${i}`));
    await collectObservability({ liara: client, overview: overviewOf(many), range: "1h", network: null, now: NOW });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

describe("collectErrors", () => {
  const ns = (offsetSec: number) => String(BigInt(NOW) * 1_000_000n - BigInt(offsetSec) * 1_000_000_000n);
  const logs = (lines: Array<[number, string, string]>) => ({ data: [{ metaData: {}, values: lines.map(([o, text, type]) => [ns(o), JSON.stringify({ _entry: text, type })]) }] });

  it("returns the last error / stderr lines per app, redacted, and skips databases", async () => {
    clearLogRedactors();
    const SECRET = "hunter2-very-secret-value";
    const { client } = clientFor((c) => {
      if (c.path === "/v2/projects/shop/logs") {
        return {
          json: logs([
            [500, "Server listening on 3000", "stdout"],
            [400, "ERROR: boom 1", "stdout"],
            [300, `Error: bad credentials ${SECRET}`, "stderr"],
            [200, "GET / 200 12ms", "stdout"],
            [100, "some stderr noise", "stderr"],
          ]),
        };
      }
      if (c.path === "/v2/projects/quiet/logs") return { json: logs([[10, "all good", "stdout"]]) };
      if (c.path === "/v1/projects/shop") return { json: { project: { project_id: "shop", envs: [{ key: "API_KEY", value: SECRET }] } } };
      if (c.path === "/v1/projects/quiet") return { json: { project: { project_id: "quiet", envs: [] } } };
      if (c.path === "/v2/projects/gone/logs") return { status: 500, json: { message: "x" } };
      if (c.path === "/v1/projects/gone") return { json: { project: { project_id: "gone", envs: [] } } };
      return { status: 404, json: {} };
    });
    const dto = await collectErrors({
      liara: client,
      scope: { accountId: "acc" },
      overview: overviewOf([app("shop"), app("quiet"), app("gone"), db("d")]),
      range: "1h",
      network: null,
      now: NOW,
    });
    expect(dto.entries.map((e) => e.id).sort()).toEqual(["gone", "quiet", "shop"]);
    const shop = dto.entries.find((e) => e.id === "shop")!;
    if (shop.unavailable) throw new Error("expected lines");
    expect(shop.count).toBe(3);
    expect(shop.lines.map((l) => l.message.includes("ERROR: boom 1") || l.message.includes("stderr noise") || l.message.includes("bad credentials"))).toEqual([true, true, true]);
    expect(JSON.stringify(dto)).not.toContain(SECRET);
    const quiet = dto.entries.find((e) => e.id === "quiet")!;
    expect(quiet).toMatchObject({ unavailable: false, count: 0, lines: [] });
    expect(dto.entries.find((e) => e.id === "gone")).toEqual({ id: "gone", name: "gone", unavailable: true });
    expect(dto.truncated).toEqual({ shown: 4, total: 4 });
  });
});
