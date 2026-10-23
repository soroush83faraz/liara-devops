// Parses the REDACTED live recording of 2026-10-23 (tests/fixtures/recorded/live-2026-10-23.json) with the real schemas.
import { describe, expect, it } from "vitest";
import { AppDetailResponseSchema, DisksResponseSchema, MetricSeriesSchema, MetricsSummarySchema, latestUsage, normalizeSeries } from "../../../lib/liara";
import fx from "../../fixtures/recorded/live-2026-10-23.json";

describe("recorded live shapes (2026-10-23)", () => {
  it("disk list by _id: no per-disk _id, filebrowserUrl kept, mounts: [] is valid", () => {
    const res = DisksResponseSchema.parse(fx.diskRoutes.listById.body);
    expect(res.disks).toHaveLength(1);
    expect(res.disks[0]).toMatchObject({ name: "data", size: 1, filebrowserUrl: expect.stringContaining("filebrowser") });
    expect(res.disks[0]._id).toBeUndefined();
    expect(res.mounts).toEqual([]);
  });

  it("project detail accepts hourlyPrice, bundleHourlyPrice, reservedDiskSpace, network and passes unknown keys through", () => {
    const { project } = AppDetailResponseSchema.parse({ project: fx.projectDetail.redactedExample });
    expect(project).toMatchObject({ _id: "SYNTH-PROJECT-ID-0001", hourlyPrice: 659.72, bundleHourlyPrice: 381.94, reservedDiskSpace: 1, isDeployed: true });
    expect(project).toHaveProperty("keepDefaultSubdomain", false);
    expect(project).toHaveProperty("dns");
    // a string network id (not an object) degrades to undefined instead of failing the whole detail
    expect(project.network).toBeUndefined();
    expect(Object.keys(fx.projectDetail.redactedExample).sort()).toEqual([...fx.projectDetail.topLevelKeys].sort());
  });

  it("metrics series and summary: unix-second samples, 30 s step, observed magnitudes", () => {
    const cpu = normalizeSeries(MetricSeriesSchema.parse(fx.metricsSeries.bodyCpu));
    expect(cpu[0].points.map((p) => p.t)).toEqual([1789999940, 1789999970, 1790000000]);
    expect(cpu[0].points[1].t - cpu[0].points[0].t).toBe(fx.metricsSeries.stepSeconds);
    expect(cpu[0].points[0].v).toBeCloseTo(0.05);
    expect(normalizeSeries(MetricSeriesSchema.parse(fx.metricsSeries.bodyMemory))[0].points[0].v).toBeCloseTo(8.2e7, -5);
    const sum = MetricsSummarySchema.parse(fx.metricsSummary.body);
    expect(latestUsage(sum.cpuUsage)).toEqual([{ applet: "synth-app-7d9f-abcde", value: 0.05 }]);
    expect(sum.disksUsage).toEqual([{ name: "data" }]);
  });
});
