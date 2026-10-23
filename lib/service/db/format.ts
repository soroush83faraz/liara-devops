import { faNumber, faPrice } from "../../i18n/format";
import { t } from "../../i18n/t";
import { monthlyFromHourly } from "../../liara/account";

/** «حدود ۵۱۸٬۴۰۰ تومان در ماه» from a toman-per-hour price (x 720). */
export function monthlyPriceText(perHour: number): string {
  return t("dbPanel.common.tomanPerMonth", { price: faPrice(monthlyFromHourly(perHour)) });
}

/** Monthly price of a plan option, or «قیمت نامشخص» when Liara gave none (never a number for an unknown price). */
export function planMonthlyText(p: { priceKnown: boolean; pricePerHour?: number }): string {
  return p.priceKnown && p.pricePerHour !== undefined ? monthlyPriceText(p.pricePerHour) : t("dbPanel.settings.priceUnknown");
}

export function hourlyPriceText(perHour: number): string {
  return t("dbPanel.common.tomanPerHour", { price: faPrice(perHour) });
}

const BYTE_UNITS = ["b", "kb", "mb", "gb", "tb"] as const;

/** «۱٫۲ مگابایت». The input is assumed to be bytes [VAL]. Invalid input renders as an em dash. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < BYTE_UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return `${faNumber(n, { maximumFractionDigits: i === 0 ? 0 : 1 })} ${t(`dbPanel.common.bytes.${BYTE_UNITS[i]!}`)}`;
}

/** Only plain http(s) links are ever rendered as anchors. */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
