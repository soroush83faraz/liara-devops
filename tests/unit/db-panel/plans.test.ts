import { describe, expect, it } from "vitest";
import { listDbPlans, type Me } from "../../../lib/liara";
import { buildPlanOptions, comparePlans } from "../../../lib/service/db/plans";

const me = {
  plans: {
    databases: {
      "small-g2": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 10, price: 100, supports: ["postgres", "mysql"] },
      "medium-g2": { available: true, region: "iran", RAM: { amount: 2 }, CPU: { amount: 2 }, volume: 20, price: 250, supports: ["postgres"] },
      "tiny-g2": { available: true, region: "iran", RAM: { amount: 0.5 }, CPU: { amount: 1 }, volume: 5, price: 50 },
      "redis-g2": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, price: 80, supports: ["redis"] },
      "gone-g2": { available: false, region: "iran", RAM: { amount: 4 }, CPU: { amount: 4 }, price: 900, supports: ["postgres"] },
    },
  },
} as unknown as Me;

const filter = { region: "any", includeLegacy: true, engine: "postgres" } as const;

describe("comparePlans", () => {
  it("computes hourly and monthly (x720) deltas with direction", () => {
    expect(comparePlans({ pricePerHour: 100, priceKnown: true }, { pricePerHour: 250, priceKnown: true })).toEqual({ deltaPerHour: 150, deltaPerMonth: 108000, direction: "up" });
    expect(comparePlans({ pricePerHour: 100, priceKnown: true }, { pricePerHour: 50, priceKnown: true })).toEqual({ deltaPerHour: -50, deltaPerMonth: -36000, direction: "down" });
    expect(comparePlans({ pricePerHour: 100, priceKnown: true }, { pricePerHour: 100, priceKnown: true })).toMatchObject({ deltaPerHour: 0, direction: "same" });
  });
  it("is unknown (no invented number) when the current plan is missing", () => {
    expect(comparePlans(undefined, { pricePerHour: 100, priceKnown: true })).toEqual({ direction: "unknown" });
  });
  it("does not accumulate float noise", () => {
    expect(comparePlans({ pricePerHour: 0.1, priceKnown: true }, { pricePerHour: 0.3, priceKnown: true }).deltaPerHour).toBe(0.2);
  });
});

describe("buildPlanOptions", () => {
  const available = listDbPlans(me, { ...filter, availableOnly: true });
  const all = listDbPlans(me, { ...filter, availableOnly: false });

  it("filters by engine support, sorts by price and flags the current plan", () => {
    const opts = buildPlanOptions(available, all, "small-g2");
    expect(opts.map((o) => o.id)).toEqual(["tiny-g2", "small-g2", "medium-g2"]);
    expect(opts.find((o) => o.id === "small-g2")?.current).toBe(true);
    expect(opts.find((o) => o.id === "medium-g2")).toMatchObject({ direction: "up", deltaPerHour: 150, current: false });
    expect(opts.find((o) => o.id === "tiny-g2")).toMatchObject({ direction: "down", deltaPerMonth: -36000 });
  });

  it("keeps a no-longer-available current plan visible so the delta has a baseline", () => {
    const opts = buildPlanOptions(available, all, "gone-g2");
    expect(opts.find((o) => o.id === "gone-g2")?.current).toBe(true);
    expect(opts.find((o) => o.id === "small-g2")).toMatchObject({ direction: "down" });
  });

  it("current plan unknown to Liara -> all deltas unknown", () => {
    const opts = buildPlanOptions(available, all, "mystery");
    expect(opts.every((o) => o.direction === "unknown" && !o.current)).toBe(true);
  });

  it("never offers plans of other engines", () => {
    expect(buildPlanOptions(available, all, "small-g2").some((o) => o.id === "redis-g2")).toBe(false);
  });
});
