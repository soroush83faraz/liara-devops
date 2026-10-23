// Display formatting helpers. Persian digits and Jalali dates for prose; ISO-8601 UTC for evidence.
import { fa } from "./fa";

export { isolateLatin, isolateValue, stripIsolates, statusCode, LRI, PDI } from "./bidi";

const LOCALE = "fa-IR";
const JALALI = "fa-IR-u-ca-persian";
const DISPLAY_TZ = "Asia/Tehran";

export type DateInput = Date | string | number;

function toDate(input: DateInput): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

const numberFormat = new Intl.NumberFormat(LOCALE);

/** 1234567 -> «۱٬۲۳۴٬۵۶۷». Non-finite input renders as an em dash. */
export function faNumber(n: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(n)) return fa.common.dash;
  return options ? new Intl.NumberFormat(LOCALE, options).format(n) : numberFormat.format(n);
}

const plainFormat = new Intl.NumberFormat(LOCALE, { useGrouping: false, maximumFractionDigits: 20 });

/**
 * Persian digits WITHOUT thousands grouping, for identifiers that are not quantities: ports, years, ids.
 * 3000 -> «۳۰۰۰» (never «۳٬۰۰۰»). Non-finite input renders as an em dash.
 */
export function faPlain(n: number | string): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (typeof n === "string" && (n.trim() === "" || !Number.isFinite(v))) return n;
  if (!Number.isFinite(v)) return fa.common.dash;
  return plainFormat.format(v);
}

/** Toman amount -> «۱۲٬۰۰۰ تومان». Fractions are rounded to whole toman. */
export function faPrice(toman: number): string {
  if (!Number.isFinite(toman)) return fa.common.dash;
  return `${faNumber(Math.round(toman))} ${fa.common.toman}`;
}

const dateFormat = new Intl.DateTimeFormat(JALALI, {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: DISPLAY_TZ,
});

const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: DISPLAY_TZ,
});

/** Jalali date in Tehran time, e.g. «۱۴ مهر ۱۴۰۴». Invalid input renders as an em dash. */
export function faDate(input: DateInput): string {
  const d = toDate(input);
  return d ? dateFormat.format(d) : fa.common.dash;
}

/** 24h time in Tehran time, e.g. «۱۵:۳۰». Invalid input renders as an em dash. */
export function faTime(input: DateInput): string {
  const d = toDate(input);
  return d ? timeFormat.format(d) : fa.common.dash;
}

/** Jalali date and 24h time in Tehran time, e.g. «۱۴ مهر ۱۴۰۴، ۱۵:۳۰». */
export function faDateTime(input: DateInput): string {
  const d = toDate(input);
  return d ? `${dateFormat.format(d)}، ${timeFormat.format(d)}` : fa.common.dash;
}

const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: "always" });

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Persian relative time: «۱۲ دقیقه پیش», «۳ ساعت دیگر». Under 45 seconds is «همین الان».
 * `now` is injectable for deterministic tests.
 */
export function relativeTime(input: DateInput, now: DateInput = new Date()): string {
  const d = toDate(input);
  const ref = toDate(now);
  if (!d || !ref) return fa.common.dash;
  const diff = Math.round((d.getTime() - ref.getTime()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return fa.common.justNow;
  const sign = diff < 0 ? -1 : 1;
  if (abs < HOUR) return relativeFormat.format(sign * Math.max(1, Math.round(abs / MINUTE)), "minute");
  if (abs < DAY) return relativeFormat.format(sign * Math.round(abs / HOUR), "hour");
  if (abs < MONTH) return relativeFormat.format(sign * Math.round(abs / DAY), "day");
  if (abs < YEAR) return relativeFormat.format(sign * Math.round(abs / MONTH), "month");
  return relativeFormat.format(sign * Math.round(abs / YEAR), "year");
}

/** ISO-8601 in UTC with a trailing Z (Latin digits), for evidence, logs and exports. */
export function isoUtc(input: DateInput): string {
  const d = toDate(input);
  if (!d) throw new RangeError("isoUtc: invalid date");
  return d.toISOString();
}
