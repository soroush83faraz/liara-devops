// All inputs are SYNTHETIC (made up for these tests); nothing here was recorded from Liara.
import { describe, expect, it } from "vitest";
import { describeError } from "../../../lib/service/app-config/errors";
import { comparePlans, monthlyOf } from "../../../lib/service/app-config/plans";
import { diskNameIssue, diskSizeCheck } from "../../../lib/service/app-config/disks";
import { fixedIpEnabled, parsePort, powerState, toggleState } from "../../../lib/service/app-config/settings";
import type { PlanOption } from "../../../lib/service/app-config/dto";

const plan = (id: string, perHour: number, ramGb: number, cpu: number): PlanOption => ({
  id,
  ramGb,
  cpu,
  priceKnown: true,
  pricePerHour: perHour,
  pricePerMonth: monthlyOf(perHour),
  available: true,
});

describe("comparePlans", () => {
  const small = plan("small", 100, 1, 1);
  const big = plan("big", 250, 2, 2);
  it("computes monthly deltas and resource deltas plan-to-plan", () => {
    const up = comparePlans(small, undefined, big);
    expect(up).toMatchObject({ direction: "up", deltaHourly: 150, deltaMonthly: 108_000, ramDeltaGb: 1, cpuDelta: 1, approximate: false });
    expect(comparePlans(big, undefined, small)).toMatchObject({ direction: "down", deltaMonthly: -108_000 });
  });
  it("recognises the same plan and equal prices", () => {
    expect(comparePlans(small, undefined, small).direction).toBe("same_plan");
    expect(comparePlans(small, undefined, plan("twin", 100, 1, 1)).direction).toBe("same_price");
  });
  it("falls back to the app's hourly price and says it is approximate; unknown without any price", () => {
    expect(comparePlans(undefined, 120.5, big)).toMatchObject({ direction: "up", approximate: true });
    expect(comparePlans(undefined, undefined, big)).toEqual({ direction: "unknown", approximate: false });
  });
});

describe("describeError", () => {
  it("maps the documented statuses to Persian", () => {
    expect(describeError({ status: 409 })).toMatchObject({ kind: "conflict", message: "عملیات دیگری در حال انجام است. کمی بعد دوباره تلاش کنید." });
    expect(describeError({ status: 402 }).kind).toBe("payment");
    expect(describeError({ status: 400, code: "frozen_project" }).kind).toBe("payment");
    expect(describeError({ status: 403 }).kind).toBe("forbidden");
    expect(describeError({ status: 403, code: "forbidden_origin" }).kind).toBe("forbidden");
    expect(describeError({ status: 401 }).kind).toBe("auth");
    expect(describeError({ status: 404 }).kind).toBe("not_found");
    expect(describeError({ status: 502 }).kind).toBe("unavailable");
    expect(describeError({ status: 504 }).kind).toBe("unavailable");
    expect(describeError({ status: 0 }).kind).toBe("network");
    expect(describeError({ status: 400, code: "typed_name_mismatch" }).kind).toBe("typed_name");
  });
  it("429 carries a countdown in the message", () => {
    const e = describeError({ status: 429, retryAfterSec: 12 });
    expect(e).toMatchObject({ kind: "rate_limited", retryAfterSec: 12 });
    expect(e.message).toContain("۱۲");
    expect(describeError({ status: 429 }).message).not.toContain("{");
  });
  it("uses server text for 400 only when it is Persian; never leaks unknown English text", () => {
    expect(describeError({ status: 400, message: "نام نامعتبر است" }).message).toBe("نام نامعتبر است");
    expect(describeError({ status: 400, message: "ZodError: secret stack" }).message).toBe("درخواست نامعتبر بود.");
    expect(describeError(new Error("boom")).kind).toBe("generic");
    expect(describeError(null).kind).toBe("generic");
  });
});

describe("disk and settings helpers", () => {
  it("validates disk names and sizes", () => {
    expect(diskNameIssue("data")).toBeNull();
    expect(diskNameIssue("")).toBe("empty");
    expect(diskNameIssue("My_Disk")).toBe("invalid");
    expect(diskSizeCheck("5")).toEqual({ ok: true, sizeGb: 5 });
    expect(diskSizeCheck("0")).toEqual({ ok: false, issue: "range" });
    expect(diskSizeCheck("1001")).toEqual({ ok: false, issue: "range" });
    expect(diskSizeCheck("2.5")).toEqual({ ok: false, issue: "not_integer" });
    expect(diskSizeCheck("")).toEqual({ ok: false, issue: "empty" });
    expect(diskSizeCheck("5", 5)).toEqual({ ok: false, issue: "not_larger" });
    expect(diskSizeCheck("6", 5)).toEqual({ ok: true, sizeGb: 6 });
  });
  it("parses ports", () => {
    expect(parsePort("3000")).toEqual({ ok: true, port: 3000 });
    for (const bad of ["", "0", "65536", "80a", "-1", "1e3"]) expect(parsePort(bad).ok).toBe(false);
  });
  it("derives toggle and power state without guessing", () => {
    expect(fixedIpEnabled("DISABLED")).toBe(false);
    expect(fixedIpEnabled("ACTIVE")).toBe(true);
    expect(fixedIpEnabled("WEIRD")).toBeUndefined();
    expect(fixedIpEnabled(undefined)).toBeUndefined();
    expect(toggleState("zero-downtime", { zeroDowntime: true })).toBe(true);
    expect(toggleState("read-only", {})).toBeUndefined();
    expect(powerState({ scale: 0 })).toBe("stopped");
    expect(powerState({ scale: 1 })).toBe("running");
    expect(powerState({})).toBe("unknown");
  });
});
