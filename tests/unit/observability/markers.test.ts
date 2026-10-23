import { describe, expect, it } from "vitest";
import { domainOf, markersForSeries, releaseMarkers } from "@/lib/observability/markers";
import type { ObsRelease } from "@/lib/observability/types";

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const rel = (id: string, sec: number): ObsRelease => ({ id, at: iso(sec), state: "READY" });
const label = (s: string) => `L:${s.slice(11, 19)}`;

describe("domainOf", () => {
  it("min and max of finite t values, null when empty", () => {
    expect(domainOf([{ t: 5 }, { t: 1 }, { t: 9 }, {}])).toEqual({ from: 1, to: 9 });
    expect(domainOf([])).toBeNull();
    expect(domainOf([{ t: Number.NaN }])).toBeNull();
  });
});

describe("releaseMarkers", () => {
  const domain = { from: 1_000, to: 2_000 };

  it("keeps only releases inside the drawn window, oldest first, never clamped to the edge", () => {
    const out = releaseMarkers([rel("late", 1_900), rel("out-before", 999), rel("early", 1_100), rel("out-after", 2_001)], domain, label);
    expect(out.map((m) => m.id)).toEqual(["early", "late"]);
    expect(out.map((m) => m.t)).toEqual([1_100, 1_900]);
  });

  it("includes the exact boundaries", () => {
    expect(releaseMarkers([rel("a", 1_000), rel("b", 2_000)], domain, label).map((m) => m.t)).toEqual([1_000, 2_000]);
  });

  it("labels with the release time through the formatter", () => {
    const [m] = releaseMarkers([rel("a", 1_500)], domain, label);
    expect(m!.label).toBe(label(iso(1_500)));
  });

  it("drops invalid timestamps and duplicates of the same second", () => {
    const bad: ObsRelease = { id: "bad", at: "not a date", state: "READY" };
    const out = releaseMarkers([bad, rel("a", 1_500), rel("dup", 1_500)], domain, label);
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("keeps the dashed line but drops the label of a marker that would overlap the previous label", () => {
    const out = releaseMarkers([rel("a", 1_100), rel("b", 1_150), rel("c", 1_600)], domain, label);
    expect(out.map((m) => [m.id, m.showLabel])).toEqual([["a", true], ["b", false], ["c", true]]);
  });

  it("no domain or no releases means no markers", () => {
    expect(releaseMarkers([rel("a", 1)], null, label)).toEqual([]);
    expect(releaseMarkers([], domain, label)).toEqual([]);
    expect(releaseMarkers(undefined, domain, label)).toEqual([]);
  });
});

describe("markersForSeries", () => {
  it("uses the time range of the plotted points", () => {
    const series = [{ points: [{ t: 1_000 }, { t: 1_400 }] }, { points: [{ t: 1_200 }, { t: 1_800 }] }];
    expect(markersForSeries([rel("in", 1_700), rel("out", 1_900)], series, label).map((m) => m.id)).toEqual(["in"]);
    expect(markersForSeries([rel("x", 1_700)], [], label)).toEqual([]);
  });
});

import { lastReleaseState } from "@/lib/observability/markers";

describe("lastReleaseState", () => {
  it("'none' only when the lookup succeeded and found nothing; a failed lookup is 'unknown'", () => {
    expect(lastReleaseState({ lastReleaseAt: "2026-01-01T00:00:00Z" })).toBe("known");
    expect(lastReleaseState({})).toBe("none");
    expect(lastReleaseState({ releasesUnavailable: true })).toBe("unknown");
  });
});
