import { describe, expect, it } from "vitest";
import { listAppPlans, listDbPlans, listDbVersions, monthlyFromHourly, MeSchema } from "../../../lib/liara";
import meFx from "../../fixtures/liara/me.synthetic.json";

const me = MeSchema.parse(meFx);

describe("plan normalisers", () => {
  it("price per month = price per hour * 720", () => {
    expect(monthlyFromHourly(100)).toBe(72_000);
    expect(monthlyFromHourly(0.5)).toBe(360);
    expect(monthlyFromHourly(0.0001)).toBe(0.07);
  });

  it("listAppPlans defaults: available, iran, g2/free only", () => {
    const plans = listAppPlans(me);
    expect(plans.map((p) => p.id)).toEqual(["free", "iran-g2-small"]);
    const small = plans[1];
    expect(small).toMatchObject({ ramGb: 1, cpu: 1, diskGb: 5, storageClass: "SSD", pricePerHour: 100, pricePerMonth: 72_000 });
    expect(small.bundles).toEqual([
      { id: "standard", available: true, monthlyPrice: 50_000, maxLogsRetentionDays: 7 },
      { id: "pro", available: false, monthlyPrice: 120_000, maxLogsRetentionDays: 30 },
    ]);
    expect(plans[0]).toMatchObject({ pricePerHour: 0, pricePerMonth: 0 });
  });

  it("filters can be relaxed", () => {
    expect(listAppPlans(me, { availableOnly: false }).map((p) => p.id)).toContain("iran-g2-big");
    expect(listAppPlans(me, { region: "any" }).map((p) => p.id)).toContain("germany-g2-small");
    const legacy = listAppPlans(me, { includeLegacy: true }).find((p) => p.id === "old-plan");
    expect(legacy?.legacy).toBe(true);
  });

  it("listDbPlans with engine filter", () => {
    expect(listDbPlans(me, { includeLegacy: true }).map((p) => p.id)).toEqual(["iran-g2-small", "redis-only"]);
    expect(listDbPlans(me, { engine: "redis", includeLegacy: true }).map((p) => p.id)).toEqual(["redis-only"]);
    const pg = listDbPlans(me, { engine: "postgres" });
    expect(pg).toHaveLength(1);
    expect(pg[0].pricePerMonth).toBe(360);
    expect(pg[0].bundles[0].monthlyPrice).toBe(10_000);
  });

  it("listDbVersions", () => {
    const v = listDbVersions(me);
    expect(v.find((e) => e.engine === "postgres")).toMatchObject({
      defaultVersion: "16",
      versions: [{ label: "16", value: "16", postgisValue: "16-postgis", pgvectorValue: "16-pgvector" }],
    });
    expect(v.find((e) => e.engine === "redis")?.versions[0].value).toBe("7");
  });

  it("survives a response without plans", () => {
    const empty = MeSchema.parse({});
    expect(listAppPlans(empty)).toEqual([]);
    expect(listDbPlans(empty)).toEqual([]);
    expect(listDbVersions(empty)).toEqual([]);
  });
});

describe("priceKnown (a missing price is never a free plan)", () => {
  const raw = (plans: Record<string, unknown>) => MeSchema.parse({ plans: { projects: plans, databases: plans } });
  const base = { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5 };

  it("is true only for a finite price > 0, or for the free plan", () => {
    const m = raw({
      free: { ...base, price: 0 },
      "a-g2": { ...base, price: 100 },
      "b-g2": { ...base },
      "c-g2": { ...base, price: 0 },
      "d-g2": { ...base, price: "100" },
      "e-g2": { ...base, price: -5 },
    });
    const by = Object.fromEntries(listAppPlans(m).map((p) => [p.id, p]));
    expect(by.free).toMatchObject({ priceKnown: true, pricePerHour: 0 });
    expect(by["a-g2"]).toMatchObject({ priceKnown: true, pricePerHour: 100, pricePerMonth: 72_000 });
    for (const id of ["b-g2", "c-g2", "d-g2", "e-g2"]) expect(by[id].priceKnown, id).toBe(false);
    expect(listDbPlans(m).find((p) => p.id === "b-g2")?.priceKnown).toBe(false);
  });

  it("a free plan without any price field is still the free plan", () => {
    expect(listAppPlans(raw({ free: { ...base } }))[0]).toMatchObject({ id: "free", priceKnown: true });
  });
});

// Shape recorded live, values copied from the 2026-10-22 spike (real, EMPTY account, read-only; see
// tests/fixtures/recorded/spike-2026-10-22.json for the redacted shapes). Only the ids/RAM/CPU/disk/hourly prices and
// bundle displayPrices reported by the spike are used; the real plan objects carry NO `region` key. Plans the spike
// did not detail (availability of the larger ones, the `free` plan's price, the `free` bundle) are filled in as
// labelled placeholders.
describe("plans as recorded live on 2026-10-22 (shape recorded live, values copied from the 2026-10-22 spike)", () => {
  const plan = (available: boolean, price: number, ram: number, cpu: number, volume: number) => ({ available, price, volume, RAM: { amount: ram, shared: false }, CPU: { amount: cpu, shared: false } });
  const bundles = (basic: number, standard: number, pro: number) => ({
    free: { available: true, price: 0, displayHourlyPrice: 0, displayPrice: 0 }, // placeholder: only the key's existence was recorded
    basic: { available: true, displayPrice: basic },
    standard: { available: true, displayPrice: standard },
    pro: { available: true, displayPrice: pro },
  });
  const live = MeSchema.parse({
    user: { _id: "SYNTHETIC-id", fullname: "SYNTHETIC", accountType: "REAL_PERSON" },
    plans: {
      projects: {
        free: plan(false, 0, 0.25, 0.25, 1), // placeholder numbers; recorded: unavailable
        "mini-g2": plan(false, 381.94, 0.25, 0.25, 5),
        "small-g2": plan(true, 659.72, 0.5, 0.5, 5),
        "medium-g2": plan(true, 1145.83, 1, 1, 5),
        "standard-base-g2": plan(true, 2048.61, 2, 1, 5),
        "standard-plus-g2": plan(true, 3680.55, 4, 2, 5),
        "pro-g2": plan(true, 6388.88, 8, 4, 5),
        "pro-plus-g2": plan(true, 11111.11, 16, 8, 5),
        "pro-max-g2": plan(true, 19444.44, 32, 16, 5),
        "express-g2": plan(true, 34166.66, 64, 32, 5),
      },
      projectBundlePlans: { "small-g2": bundles(275_000, 475_000, 825_000), "mini-g2": bundles(0, 0, 0) },
      databases: {
        free: { ...plan(false, 0, 0.25, 0.25, 1), supports: ["postgres"] },
        "mini-g2": { ...plan(false, 381.94, 0.25, 0.25, 5), supports: ["postgres"] },
        "small-g2": { ...plan(true, 659.72, 0.5, 0.5, 5), supports: ["postgres", "mysql", "redis"] },
        "standard-pro-g2": { ...plan(true, 3680.55, 4, 2, 5), supports: ["postgres"] },
      },
      databaseBundlePlans: {},
    },
  });

  it("small-g2 is available, priced 659.72/h (x720 monthly) with the basic/standard/pro bundles and their monthly displayPrice", () => {
    const small = listAppPlans(live).find((p) => p.id === "small-g2");
    expect(small).toMatchObject({ available: true, priceKnown: true, pricePerHour: 659.72, pricePerMonth: monthlyFromHourly(659.72), ramGb: 0.5, cpu: 0.5, diskGb: 5, legacy: false });
    expect(small?.pricePerMonth).toBe(474_998.4);
    const byId = Object.fromEntries((small?.bundles ?? []).map((b) => [b.id, b]));
    expect(Object.keys(byId)).toEqual(expect.arrayContaining(["basic", "standard", "pro"]));
    expect([byId.basic.monthlyPrice, byId.standard.monthlyPrice, byId.pro.monthlyPrice]).toEqual([275_000, 475_000, 825_000]);
    expect([byId.basic.available, byId.standard.available, byId.pro.available]).toEqual([true, true, true]);
  });

  it("free and mini-g2 are unavailable: hidden by default, present (available:false) when availability is not filtered", () => {
    expect(listAppPlans(live).map((p) => p.id)).not.toContain("free");
    expect(listAppPlans(live).map((p) => p.id)).not.toContain("mini-g2");
    const all = listAppPlans(live, { availableOnly: false });
    expect(all.find((p) => p.id === "free")?.available).toBe(false);
    expect(all.find((p) => p.id === "mini-g2")).toMatchObject({ available: false, pricePerHour: 381.94, priceKnown: true });
  });

  it("the larger plans and the db plans (standard-pro-g2, not standard-plus-g2) normalise with the recorded ids and prices", () => {
    const prices = Object.fromEntries(listAppPlans(live).map((p) => [p.id, p.pricePerHour]));
    expect(prices).toEqual({
      "small-g2": 659.72,
      "medium-g2": 1145.83,
      "standard-base-g2": 2048.61,
      "standard-plus-g2": 3680.55,
      "pro-g2": 6388.88,
      "pro-plus-g2": 11111.11,
      "pro-max-g2": 19444.44,
      "express-g2": 34166.66,
    });
    expect(listAppPlans(live).find((p) => p.id === "express-g2")).toMatchObject({ ramGb: 64, cpu: 32 });
    const db = listDbPlans(live, { engine: "postgres" });
    expect(db.map((p) => p.id)).toEqual(["small-g2", "standard-pro-g2"]);
    expect(db.every((p) => p.priceKnown)).toBe(true);
    expect(listDbPlans(live, { includeLegacy: true, availableOnly: false }).map((p) => p.id)).not.toContain("standard-plus-g2");
  });
});
