// SYNTHETIC probe results.
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeAlerts,
  classifyProbe,
  isFailing,
  nextHealth,
  useHealthStore,
  type ServiceHealth,
} from "@/lib/canvas/health-store";
import { dueServices } from "@/lib/canvas/probe-schedule";
import type { ProbeResult } from "@/lib/canvas/types";

const ok = (at = "2026-01-01T00:00:00Z"): ProbeResult => ({ ok: true, status: 200, latencyMs: 40, checkedAt: at });
const down = (at = "2026-01-01T00:01:00Z"): ProbeResult => ({ ok: false, latencyMs: 6000, checkedAt: at, error: "timeout" });

describe("classifyProbe", () => {
  it("separates reachable-with-4xx from down", () => {
    expect(classifyProbe({ ok: true, status: 204 })).toBe("ok");
    expect(classifyProbe({ ok: false, status: 404 })).toBe("degraded");
    expect(classifyProbe({ ok: false, status: 503 })).toBe("down");
    expect(classifyProbe({ ok: false })).toBe("down");
  });
});

describe("nextHealth", () => {
  it("alerts exactly once after two consecutive failures following a healthy state", () => {
    let h: ServiceHealth | undefined;
    const steps = [ok(), down(), down(), down()].map((r) => {
      const n = nextHealth(h, r);
      h = n.health;
      return n.raiseAlert;
    });
    expect(steps).toEqual([false, false, true, false]);
    expect(h?.consecutiveFailures).toBe(3);
    expect(isFailing(h)).toBe(true);
  });
  it("a single blip does not alert and resets the counter", () => {
    let h = nextHealth(undefined, ok()).health;
    expect(nextHealth(h, down()).raiseAlert).toBe(false);
    h = nextHealth(nextHealth(h, down()).health, ok()).health;
    expect(h.consecutiveFailures).toBe(0);
    expect(isFailing(h)).toBe(false);
  });
  it("does not alert on a cold start that never was healthy", () => {
    const a = nextHealth(undefined, down());
    expect(nextHealth(a.health, down()).raiseAlert).toBe(false);
    expect(isFailing(nextHealth(a.health, down()).health)).toBe(true);
  });
  it("4xx counts as reachable, not as a failure", () => {
    const n = nextHealth(nextHealth(undefined, ok()).health, { ok: false, status: 404, latencyMs: 10, checkedAt: "x" });
    expect(n.health).toMatchObject({ status: "degraded", consecutiveFailures: 0 });
  });
  it("reports recovery after an alert-level failure streak", () => {
    let h = nextHealth(undefined, ok()).health;
    h = nextHealth(h, down()).health;
    h = nextHealth(h, down()).health;
    expect(nextHealth(h, ok()).recovered).toBe(true);
  });
});

describe("useHealthStore", () => {
  beforeEach(() => useHealthStore.setState({ byService: {}, alerts: [] }));

  it("raises one persistent alert, resolves it on recovery, and supports dismiss", () => {
    const { record } = useHealthStore.getState();
    record("web", ok());
    record("web", down());
    expect(useHealthStore.getState().alerts).toHaveLength(0);
    record("web", down());
    record("web", down());
    let s = useHealthStore.getState();
    expect(s.alerts).toHaveLength(1);
    expect(activeAlerts(s.alerts)).toHaveLength(1);
    expect(s.byService.web.consecutiveFailures).toBe(3);
    record("web", ok());
    s = useHealthStore.getState();
    expect(activeAlerts(s.alerts)).toHaveLength(0);
    expect(s.alerts[0].resolvedAt).toBeDefined();

    record("web", down());
    record("web", down());
    s = useHealthStore.getState();
    expect(s.alerts).toHaveLength(2);
    useHealthStore.getState().dismissAll();
    expect(activeAlerts(useHealthStore.getState().alerts)).toHaveLength(0);
  });

  it("prunes services that disappeared", () => {
    const { record, prune } = useHealthStore.getState();
    record("a", ok());
    record("b", ok());
    prune(new Set(["a"]));
    expect(Object.keys(useHealthStore.getState().byService)).toEqual(["a"]);
  });
});

describe("dueServices", () => {
  it("caps concurrency at 3 and orders by overdue-ness", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(dueServices(ids, { nextAt: new Map(), inFlight: new Set() }, 1000)).toHaveLength(3);
    expect(dueServices(ids, { nextAt: new Map(), inFlight: new Set(["a", "b", "c"]) }, 1000)).toEqual([]);
    expect(dueServices(ids, { nextAt: new Map([["a", 5000], ["b", 10], ["c", 20]]), inFlight: new Set() }, 1000)).toEqual(["d", "e", "b"]);
  });
});
