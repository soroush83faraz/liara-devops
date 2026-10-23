import { describe, expect, it } from "vitest";
import { faDate, faDateTime, faNumber, faPrice, isoUtc, relativeTime } from "../../../lib/i18n/format";

const NOW = new Date("2025-10-06T12:00:00Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("faNumber", () => {
  it("uses Persian digits and separators", () => {
    expect(faNumber(1234567)).toBe("۱٬۲۳۴٬۵۶۷");
    expect(faNumber(0)).toBe("۰");
    expect(faNumber(12.5)).toBe("۱۲٫۵");
  });
  it("renders non-finite numbers as a dash", () => {
    expect(faNumber(Number.NaN)).toBe("—");
    expect(faNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("faPrice", () => {
  it("appends the currency and rounds to whole toman", () => {
    expect(faPrice(12000)).toBe("۱۲٬۰۰۰ تومان");
    expect(faPrice(12000.6)).toBe("۱۲٬۰۰۱ تومان");
    expect(faPrice(0)).toBe("۰ تومان");
  });
  it("handles invalid amounts", () => {
    expect(faPrice(Number.NaN)).toBe("—");
  });
});

describe("faDate / faDateTime (Jalali, Tehran time)", () => {
  it("formats a known date", () => {
    expect(faDate(NOW)).toBe("۱۴ مهر ۱۴۰۴");
    expect(faDate("2025-10-06T12:00:00Z")).toBe("۱۴ مهر ۱۴۰۴");
  });
  it("adds 24h Tehran time", () => {
    // 12:00Z is 15:30 in Tehran (UTC+3:30).
    expect(faDateTime(NOW)).toBe("۱۴ مهر ۱۴۰۴، ۱۵:۳۰");
  });
  it("handles the new-year boundary in the Jalali calendar", () => {
    expect(faDate("2025-03-21T00:00:00Z")).toBe("۱ فروردین ۱۴۰۴");
  });
  it("renders invalid input as a dash", () => {
    expect(faDate("not a date")).toBe("—");
    expect(faDateTime(Number.NaN)).toBe("—");
  });
});

describe("relativeTime", () => {
  it("says just now for tiny differences", () => {
    expect(relativeTime(ago(10), NOW)).toBe("همین الان");
    expect(relativeTime(ago(-10), NOW)).toBe("همین الان");
  });
  it("formats past minutes, hours and days in Persian", () => {
    expect(relativeTime(ago(12 * 60), NOW)).toBe("۱۲ دقیقه پیش");
    expect(relativeTime(ago(3 * 3600), NOW)).toBe("۳ ساعت پیش");
    expect(relativeTime(ago(2 * 86400), NOW)).toBe("۲ روز پیش");
    expect(relativeTime(ago(65 * 86400), NOW)).toBe("۲ ماه پیش");
  });
  it("formats the future", () => {
    expect(relativeTime(ago(-5 * 60), NOW)).toBe("۵ دقیقه بعد");
  });
  it("never prints 0 minutes", () => {
    expect(relativeTime(ago(50), NOW)).toBe("۱ دقیقه پیش");
  });
  it("accepts ISO strings and timestamps", () => {
    expect(relativeTime("2025-10-06T11:48:00Z", NOW)).toBe("۱۲ دقیقه پیش");
    expect(relativeTime(NOW.getTime() - 12 * 60_000, NOW)).toBe("۱۲ دقیقه پیش");
  });
  it("handles invalid dates", () => {
    expect(relativeTime("garbage", NOW)).toBe("—");
  });
});

describe("isoUtc", () => {
  it("returns Latin-digit ISO-8601 with Z", () => {
    expect(isoUtc(NOW)).toBe("2025-10-06T12:00:00.000Z");
    expect(isoUtc("2025-10-06T15:30:00+03:30")).toBe("2025-10-06T12:00:00.000Z");
    expect(isoUtc(0)).toBe("1970-01-01T00:00:00.000Z");
  });
  it("throws a RangeError for invalid input instead of returning garbage evidence", () => {
    expect(() => isoUtc("nope")).toThrow(RangeError);
  });
});

describe("formatDuration", () => {
  it("omits zero units", async () => {
    const { formatDuration } = await import("../../../lib/service/app-read/format");
    expect(formatDuration(24 * 3600 * 1000)).toBe("۲۴ ساعت");
    expect(formatDuration((3600 + 5 * 60) * 1000)).toBe("۱ ساعت و ۵ دقیقه");
    expect(formatDuration(120 * 1000)).toBe("۲ دقیقه");
    expect(formatDuration(125 * 1000)).toBe("۲ دقیقه و ۵ ثانیه");
  });
});
