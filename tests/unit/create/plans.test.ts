import { describe, expect, it } from "vitest";
import { MeSchema } from "@/lib/liara/schemas";
import { dbPlansFor, isSelectable, isVisiblePlan, normalizePlans } from "@/lib/create/plans";
import { me, rawMe } from "./helpers";

describe("normalizePlans", () => {
  const out = normalizePlans({ me: me(), balanceToman: 1234, networks: [{ id: "n1", name: "main" }], now: new Date("2026-01-01T00:00:00Z") });

  it("applies the CLI-like filter and says that it did", () => {
    expect(out.appPlans.map((p) => p.id)).toEqual(["free", "iran-g2-small", "iran-g2-nopice"]);
    expect(out.filtered).toEqual({ apps: true, dbs: false });
    expect(out.dbPlans.map((p) => p.id)).toEqual(["iran-g2-small", "iran-g2-redis", "iran-g2-any"]);
  });

  it("converts units and keeps price math hourly x 720", () => {
    const small = out.appPlans.find((p) => p.id === "iran-g2-small")!;
    expect(small).toMatchObject({ ramMb: 1024, cpu: 1, diskGb: 5, hourlyToman: 100, monthlyToman: 72000, region: "iran", available: true });
    expect(out.appPlans.find((p) => p.id === "free")).toMatchObject({ ramMb: 256, hourlyToman: 0, monthlyToman: 0 });
    expect(out.dbPlans[0]).toMatchObject({ hourlyToman: 0.5, monthlyToman: 360, volumeGb: 10, supports: ["postgres", "mysql"] });
  });

  it("never invents a price: a plan without one is omitted from pricing and not selectable", () => {
    const p = out.appPlans.find((x) => x.id === "iran-g2-nopice")!;
    expect("hourlyToman" in p).toBe(false);
    expect("monthlyToman" in p).toBe(false);
    expect(p.ramMb).toBe(2048);
    expect(isSelectable(p)).toBe(false);
    expect(isSelectable(out.appPlans[0])).toBe(true);
  });

  it("lists only available bundle plans and skips malformed entries", () => {
    expect(out.bundlePlans["iran-g2-small"].map((b) => b.id)).toEqual(["standard", "pro"]);
    expect(out.bundlePlans["iran-g2-small"][0].displayPrice).toBe(50000);
    expect(out.dbBundlePlans["iran-g2-small"]).toHaveLength(1);
  });

  it("normalises versions: drops empty/invalid engines, keeps only defaults that exist", () => {
    expect(Object.keys(out.dbVersions).sort()).toEqual(["postgres", "redis"]);
    expect(out.defaultDbVersions).toEqual({ postgres: "15" }); // redis default "9" is not in the list
  });

  it("exposes platforms, networks, balance and flags; reports partial data", () => {
    expect(out.platforms).toHaveLength(14);
    expect(out.networks).toEqual([{ id: "n1", name: "main" }]);
    expect(out.balanceToman).toBe(1234);
    expect(out.flags).toEqual({ privateNetworkFeature: true, legacyNetworkFeature: false });
    expect(out.partial).toEqual([]);
    expect(out.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    const partial = normalizePlans({ me: me() });
    expect(partial.partial).toEqual(["balance", "networks"]);
    expect("balanceToman" in partial).toBe(false);
    expect(partial.networks).toEqual([]);
  });

  it("is lenient with an empty account payload", () => {
    const empty = normalizePlans({ me: MeSchema.parse({}) });
    expect(empty).toMatchObject({ appPlans: [], dbPlans: [], dbVersions: {}, flags: {}, filtered: { apps: false, dbs: false } });
  });

  it("does not mutate or depend on key order of the input", () => {
    const copy = structuredClone(rawMe);
    normalizePlans({ me: MeSchema.parse(copy) });
    expect(copy).toEqual(rawMe);
  });
});

describe("plan helpers", () => {
  it("isVisiblePlan: available, iran or unspecified region, free or g2", () => {
    expect(isVisiblePlan("free", { available: true })).toBe(true);
    expect(isVisiblePlan("iran-g2-small", { available: true, region: "iran" })).toBe(true);
    expect(isVisiblePlan("iran-g2-small", { available: true, region: "germany" })).toBe(false);
    expect(isVisiblePlan("iran-g2-small", { available: false, region: "iran" })).toBe(false);
    expect(isVisiblePlan("legacy-1", { available: true })).toBe(false);
  });

  it("dbPlansFor: filters by supported engine; empty `supports` means any", () => {
    const out = normalizePlans({ me: me() });
    expect(dbPlansFor(out, "redis").map((p) => p.id)).toEqual(["iran-g2-redis", "iran-g2-any"]);
    expect(dbPlansFor(out, "postgres").map((p) => p.id)).toEqual(["iran-g2-small", "iran-g2-any"]);
    expect(dbPlansFor(out, undefined)).toEqual([]);
  });
});
