import { describe, expect, it } from "vitest";
import { chartMax, chartNumber, chartTime, niceTicks, seriesDash } from "@/lib/ui/chart-axis";

describe("chart axis helpers", () => {
  it("y ticks climb in even, round steps from 0 and clear the max", () => {
    expect(niceTicks(140, 2)).toEqual({ top: 150, ticks: [0, 75, 150] });
    expect(niceTicks(280, 2)).toEqual({ top: 300, ticks: [0, 150, 300] });
    expect(niceTicks(1450, 2)).toEqual({ top: 1500, ticks: [0, 750, 1500] });
    expect(niceTicks(0.3, 2)).toEqual({ top: 0.3, ticks: [0, 0.15, 0.3] });
    expect(niceTicks(1024, 4).ticks).toEqual([0, 300, 600, 900, 1200]);
    for (const max of [0.07, 3.3, 99, 1234, 87_000]) {
      const { ticks, top } = niceTicks(max, 4);
      expect(top).toBeGreaterThanOrEqual(max);
      const steps = ticks.slice(1).map((v, i) => Number((v - ticks[i]!).toPrecision(9)));
      expect(new Set(steps).size, `even steps for ${max}`).toBe(1);
    }
  });

  it("an empty or zero series still gets a 0..1 axis", () => {
    expect(niceTicks(0, 2)).toEqual({ top: 1, ticks: [0, 0.5, 1] });
    expect(niceTicks(Number.NaN, 2).top).toBe(1);
  });

  it("max is per key, or the row sum when stacked, never below the floor", () => {
    const rows = [{ t: 1, a: 2, b: 3 }, { t: 2, a: 4, b: 1 }];
    expect(chartMax(rows, ["a", "b"], false)).toBe(4);
    expect(chartMax(rows, ["a", "b"], true)).toBe(5);
    expect(chartMax(rows, ["a"], false, 10)).toBe(10);
  });

  it("labels use Persian digits and the Persian decimal separator", () => {
    expect(chartNumber(0.15)).toBe("۰٫۱۵");
    expect(chartNumber(1500)).toBe("۱٬۵۰۰");
    expect(chartTime(Date.UTC(2026, 0, 1, 12, 44) / 1000)).toBe("۱۶:۱۴");
  });

  it("only overlaid (not stacked) series after the first are dashed", () => {
    expect(seriesDash(0, false)).toBeUndefined();
    expect(seriesDash(1, false)).toBeDefined();
    expect(seriesDash(1, true)).toBeUndefined();
  });
});
