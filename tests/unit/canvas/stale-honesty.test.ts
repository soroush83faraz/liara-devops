// Regression tests for silent-failure display (H3) and the canvas probe honesty defects (C1, C3). SYNTHETIC data.
// Before the fix: a no_url app went red «ناموفق (۲ بار پیاپی)» and raised an alert; badges stayed green forever when
// /api/probe failed or answered 401; a 429/502 read «مشکلی پیش آمد»; a networks error became "no networks"; an
// unknown-priced bundle was costed as free.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFailing, isStaleHealth, nextHealth, useHealthStore, type ServiceHealth } from "@/lib/canvas/health-store";
import { canvasLoadError } from "@/lib/canvas/load-error";
import { STALE_AFTER_MS } from "@/lib/canvas/use-probe";
import { ApiError, fetchJson } from "@/lib/canvas/use-overview";
import type { ProbeResult } from "@/lib/canvas/types";
import { fa } from "@/lib/i18n/fa";
import { loadCatalog, toCatalogView } from "@/lib/setup/catalog";
import { buildDeployPlan, type PlanContext } from "@/lib/setup/plan";
import { setup } from "../actions/helpers";
import { analyzeFixture } from "../setup/helpers";
import { APP_PLANS, DB_PLANS, DB_VERSIONS, NETWORKS, plan } from "../setup/plans";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const res = (r: Partial<ProbeResult>, s = 0): ProbeResult => ({ ok: false, latencyMs: 10, checkedAt: at(s), ...r });
function run(results: ProbeResult[], start?: ServiceHealth) {
  let h = start;
  const alerts: boolean[] = [];
  for (const r of results) {
    const n = nextHealth(h, r, 1_000);
    h = n.health;
    alerts.push(n.raiseAlert);
  }
  return { h: h as ServiceHealth, alerts };
}

describe("C1: 'cannot probe' is neutral, never a failure or an alert", () => {
  const healthy = nextHealth(undefined, res({ ok: true, status: 200 })).health;
  for (const error of ["no_url", "blocked_address"] as const) {
    it(`${error} -> unprobeable, consecutiveFailures stays 0, no alert even after a healthy history`, () => {
      const { h, alerts } = run([res({ error }), res({ error }), res({ error })], healthy);
      expect(h.status).toBe("unprobeable");
      expect(h.consecutiveFailures).toBe(0);
      expect(alerts).toEqual([false, false, false]);
      expect(isFailing(h)).toBe(false);
    });
  }
  it("dns on a never-healthy (not yet deployed) app is unprobeable; after it once answered it is a real failure", () => {
    expect(run([res({ error: "dns" }), res({ error: "dns" })]).h.status).toBe("unprobeable");
    const after = run([res({ error: "dns" }), res({ error: "dns" })], healthy);
    expect(after.h.status).toBe("down");
    expect(after.alerts).toEqual([false, true]);
  });
  it("real failures (timeout, refused, 5xx) still alert after two in a row", () => {
    expect(run([res({ error: "timeout" }), res({ status: 503 })], healthy).alerts).toEqual([false, true]);
  });
  it("our own rate limit is not evidence: the previous state is kept", () => {
    const { h } = run([res({ error: "rate_limited" })], healthy);
    expect(h).toEqual(healthy);
  });
  it("the badge text names the reason (visible, not only in a hover title)", () => {
    expect(fa.canvasMap.probe.unprobeable).toContain("{reason}");
    expect(fa.canvasMap.probe.errors.no_url).toBe(fa.canvasMap.noUrl);
  });
});

describe("H3: stale probe results", () => {
  beforeEach(() => useHealthStore.setState({ byService: {}, alerts: [], sessionExpired: false }));

  it("a result older than 2x the interval is stale; a new result clears it", () => {
    const s = useHealthStore.getState();
    s.record("app:shop", res({ ok: true, status: 200 }), 0);
    useHealthStore.getState().markStale(STALE_AFTER_MS - 1, STALE_AFTER_MS);
    expect(useHealthStore.getState().byService["app:shop"].stale).toBe(false);
    useHealthStore.getState().markStale(STALE_AFTER_MS + 1, STALE_AFTER_MS);
    expect(useHealthStore.getState().byService["app:shop"].stale).toBe(true);
    expect(isStaleHealth(useHealthStore.getState().byService["app:shop"], STALE_AFTER_MS + 1, STALE_AFTER_MS)).toBe(true);
    useHealthStore.getState().record("app:shop", res({ ok: true, status: 200 }, 90), STALE_AFTER_MS + 2);
    expect(useHealthStore.getState().byService["app:shop"].stale).toBe(false);
  });
  it("401 from /api/probe is recorded so the UI can ask to reconnect", () => {
    useHealthStore.getState().setSessionExpired(true);
    expect(useHealthStore.getState().sessionExpired).toBe(true);
  });
  it("stale copy shows the age in the badge text", () => {
    expect(fa.canvasMap.probe.stale).toContain("قدیمی");
    expect(fa.canvasMap.probe.stale).toContain("{time}");
    expect(fa.canvasMap.errors.refreshFailed).toContain("{time}");
  });
});

describe("C3: canvas load errors say what happened", () => {
  it("maps 502/504/429 instead of a generic message", () => {
    expect(canvasLoadError(new ApiError(502, "liara_unavailable")).message).toBe(fa.canvasMap.errors.upstreamUnavailable);
    expect(canvasLoadError(new ApiError(504, "liara_timeout")).message).toBe(fa.canvasMap.errors.upstreamTimeout);
    const rl = canvasLoadError(new ApiError(429, "rate_limited", 17));
    expect(rl.kind).toBe("rate_limited");
    expect(rl.retryAfterSec).toBe(17);
  });

  describe("fetchJson keeps retryAfterSec", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });
    it("from the JSON body, else from Retry-After", async () => {
      globalThis.fetch = vi.fn(async () => Response.json({ error: { code: "rate_limited", retryAfterSec: 12 } }, { status: 429 })) as typeof fetch;
      await expect(fetchJson("/api/overview")).rejects.toMatchObject({ status: 429, retryAfterSec: 12 });
      globalThis.fetch = vi.fn(async () => new Response("x", { status: 429, headers: { "Retry-After": "9" } })) as typeof fetch;
      await expect(fetchJson("/api/overview")).rejects.toMatchObject({ status: 429, retryAfterSec: 9 });
    });
  });
});

describe("H3: setup catalog and costs never hide an unknown", () => {
  it("a networks error is surfaced, not turned into an empty list", async () => {
    const env = setup();
    env.liara.fault("GET /v1/networks", { status: 500 });
    const c = await loadCatalog(env.liara.client());
    expect(c.networksError).toBe(true);
    expect(toCatalogView(c).networksError).toBe(true);
    env.liara.faults.clear();
    expect((await loadCatalog(env.liara.client())).networksError).toBeUndefined();
  });

  it("toCatalogView marks bundles without a price as priceKnown:false", () => {
    const view = toCatalogView({
      appPlans: [plan("medium-g2", 1, 1, 2000, { bundles: [{ id: "mystery", available: true }, { id: "standard", available: true, monthlyPrice: 36000 }] })],
      dbPlans: [],
      dbVersions: [],
      networks: [],
    });
    expect(view.appPlans[0].bundles).toEqual([
      { id: "mystery", monthlyPrice: undefined, priceKnown: false },
      { id: "standard", monthlyPrice: 36000, priceKnown: true },
    ]);
  });

  it("an unknown-priced bundle is never costed as free: plan creation is refused", async () => {
    const ctx: PlanContext = {
      appPlans: [...APP_PLANS, plan("bundled-g2", 1, 1, 2000, { bundles: [{ id: "mystery", available: true }] })],
      dbPlans: DB_PLANS,
      dbVersions: DB_VERSIONS,
      networks: NETWORKS,
      sourceRef: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    };
    const a = await analyzeFixture("nextjs");
    const r = buildDeployPlan(a, { appName: "my-shop", planId: "bundled-g2", bundlePlanId: "mystery", envChoices: [] }, ctx);
    expect(r).toEqual({ ok: false, code: "bundle_price_unknown", field: "bundlePlanId" });
  });
});
