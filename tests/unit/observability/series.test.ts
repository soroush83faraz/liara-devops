import { describe, expect, it } from "vitest";
import type { MetricsDto, MetricsUnavailableDto } from "@/lib/service/app-read/types";
import { hiddenStorageKey, sanitizeHidden } from "@/lib/observability/prefs";
import {
  bucketSeconds,
  currentValue,
  displayValue,
  limitValue,
  sectionTotals,
  seriesStats,
  stackServices,
  usageRatio,
} from "@/lib/observability/series";
import { isUnhealthy, summarize } from "@/lib/observability/summary";

const sec = (series: Array<{ applet?: string; points: Array<[number, number]> }>) => ({
  unavailable: false as const,
  series: series.map((s) => ({ ...(s.applet ? { applet: s.applet } : {}), points: s.points.map(([t, v]) => ({ t, v })) })),
});

describe("bucketSeconds", () => {
  it("is about 1/60 of the window", () => {
    expect(bucketSeconds("15m")).toBe(15);
    expect(bucketSeconds("1h")).toBe(60);
    expect(bucketSeconds("6h")).toBe(360);
    expect(bucketSeconds("24h")).toBe(1440);
  });
});

describe("sectionTotals", () => {
  it("averages within a bucket, then sums applets", () => {
    const s = sec([
      { applet: "a", points: [[0, 1], [10, 3], [60, 5]] },
      { applet: "b", points: [[5, 10], [60, 20]] },
    ]);
    expect(sectionTotals(s, 60)).toEqual([{ t: 0, v: 2 + 10 }, { t: 60, v: 5 + 20 }]);
  });
  it("emits a bucket only when somebody reported in it, and never fills gaps", () => {
    const s = sec([{ points: [[0, 1], [300, 2]] }]);
    expect(sectionTotals(s, 60).map((p) => p.t)).toEqual([0, 300]);
  });
  it("applies the unit mapper and returns [] for unavailable sections", () => {
    expect(sectionTotals(sec([{ points: [[0, 2_097_152]] }]), 60, (v) => v / 1_048_576)).toEqual([{ t: 0, v: 2 }]);
    expect(sectionTotals({ unavailable: true }, 60)).toEqual([]);
  });
  it("ignores non-finite samples", () => {
    expect(sectionTotals(sec([{ points: [[0, Number.NaN], [1, 4]] }]), 60)).toEqual([{ t: 0, v: 4 }]);
  });
});

describe("stackServices", () => {
  it("aligns lines on timestamps; a service with no sample in a bucket has no key there (absent, not zero)", () => {
    const r = stackServices([
      { id: "a", label: "A", color: "#111", points: [{ t: 0, v: 1 }, { t: 60, v: 2 }] },
      { id: "b", label: "B", color: "#222", points: [{ t: 60, v: 5 }] },
      { id: "c", label: "C", color: "#333", points: [] },
    ]);
    expect(r.keys).toEqual([
      { key: "s0", id: "a", label: "A", color: "#111" },
      { key: "s1", id: "b", label: "B", color: "#222" },
    ]);
    expect(r.rows).toEqual([{ t: 0, s0: 1 }, { t: 60, s0: 2, s1: 5 }]);
  });
});

describe("seriesStats", () => {
  it("min / avg / max, null for nothing", () => {
    expect(seriesStats([2, 4, 6])).toEqual({ min: 2, avg: 4, max: 6 });
    expect(seriesStats([])).toBeNull();
    expect(seriesStats([Number.NaN])).toBeNull();
  });
});

const dto = (extra: Partial<MetricsDto> = {}): MetricsDto => ({
  range: "1h",
  since: 0,
  unitsVerified: false,
  cpu: sec([{ applet: "a", points: [[0, 0.1], [60, 0.2]] }]),
  memory: sec([{ applet: "a", points: [[0, 1], [60, 2_097_152]] }]),
  networkRx: { unavailable: true },
  networkTx: { unavailable: true },
  ...extra,
});

describe("current value and limits", () => {
  it("prefers the summary call (sum over applets) and falls back to the newest points", () => {
    const withSummary = dto({ current: { cpu: [{ value: 0.3 }, { value: 0.2 }], memory: [], disks: [] } });
    expect(currentValue(withSummary, "cpu")).toBeCloseTo(0.5);
    expect(currentValue(withSummary, "memory")).toBe(2_097_152); // empty summary list -> series fallback
    expect(currentValue(dto(), "cpu")).toBe(0.2);
  });
  it("undefined when nothing is known or the service is unavailable", () => {
    const unavailable: MetricsUnavailableDto = { unavailable: true, reason: "request_failed", range: "1h" };
    expect(currentValue(unavailable, "cpu")).toBeUndefined();
    expect(currentValue(dto({ cpu: { unavailable: true } }), "cpu")).toBeUndefined();
  });
  it("limit: cores for CPU, MiB for memory, undefined when the plan did not say", () => {
    expect(limitValue(dto({ limits: { cpu: 2, ramGb: 1.5 } }), "cpu")).toBe(2);
    expect(limitValue(dto({ limits: { cpu: 2, ramGb: 1.5 } }), "memory")).toBe(1536);
    expect(limitValue(dto(), "cpu")).toBeUndefined();
    expect(limitValue(dto({ limits: { cpu: 0 } }), "cpu")).toBeUndefined();
  });
  it("display units and ratio", () => {
    expect(displayValue("memory", 1_048_576)).toBe(1);
    expect(displayValue("cpu", 0.5)).toBe(0.5);
    expect(usageRatio(0.5, 2)).toBe(0.25);
    expect(usageRatio(5, 2)).toBe(1);
    expect(usageRatio(undefined, 2)).toBeUndefined();
    expect(usageRatio(1, undefined)).toBeUndefined();
    expect(usageRatio(1, 0)).toBeUndefined();
  });
});

describe("summarize", () => {
  const services = [
    { id: "a", status: "running" as const },
    { id: "b", status: "failed" as const },
    { id: "c", status: "running" as const },
    { id: "d", status: "stopped" as const },
  ];
  it("counts healthy / unhealthy and errors over the services whose scan succeeded", () => {
    const s = summarize(services, (id) => id === "c", new Map([["a", 2], ["b", 0], ["c", 0], ["d", 0]]));
    expect(s).toMatchObject({ total: 4, healthy: 1, unhealthy: 2 });
    expect(s.errors).toEqual({ kind: "known", withErrors: 1, scanned: 4, total: 4 });
  });
  it("a failed or missing scan is unknown, never 0 (regression: all scans unavailable)", () => {
    expect(summarize(services, () => false, null).errors).toEqual({ kind: "unknown" });
    // the dashboard passes only successful entries: every scan failed -> empty map
    expect(summarize(services, () => false, new Map()).errors).toEqual({ kind: "unknown" });
    expect(summarize([], () => false, new Map()).errors).toEqual({ kind: "unknown" });
  });
  it("partial scan: counts only scanned services; databases and capped services are not 'no errors'", () => {
    const withDb = [...services, { id: "db:x", status: "running" as const }];
    const s = summarize(withDb, () => false, new Map([["a", 1], ["c", 0]]), 3);
    // a and c scanned; b failed, d stopped-but-not-scanned, db never scanned, 3 beyond the cap
    expect(s.errors).toEqual({ kind: "known", withErrors: 1, scanned: 2, total: 8 });
  });
  it("the attention rule matches the canvas cards", () => {
    expect(isUnhealthy("failed", false)).toBe(true);
    expect(isUnhealthy("unhealthy", false)).toBe(true);
    expect(isUnhealthy("running", true)).toBe(true);
    expect(isUnhealthy("stopped", false)).toBe(false);
  });
});

describe("hidden-service preference", () => {
  it("is keyed per account", () => {
    expect(hiddenStorageKey("a1")).not.toBe(hiddenStorageKey("a2"));
  });
  it("sanitizes whatever was in storage", () => {
    expect(sanitizeHidden(["ok", "db:host", "bad id", 5, null, "ok", "x".repeat(200)])).toEqual(["ok", "db:host"]);
    expect(sanitizeHidden({})).toEqual([]);
    expect(sanitizeHidden("nope")).toEqual([]);
  });
});
