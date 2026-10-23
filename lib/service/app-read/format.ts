import { fa } from "../../i18n/fa";
import { faNumber } from "../../i18n/format";
import { t } from "../../i18n/t";
import { BYTES_PER_MIB } from "./chart-data";

/** «۲ دقیقه و ۵ ثانیه», «۲۴ ساعت». Undefined input renders as the common dash. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return fa.common.dash;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return t("appOps.releases.seconds", { n: totalSec });
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? t("appOps.releases.minutesSeconds", { m, s }) : t("appOps.releases.minutes", { n: m });
  // Zero units are omitted: «۲۴ ساعت», not «۲۴ ساعت و ۰ دقیقه».
  const h = Math.floor(m / 60);
  return m % 60 ? t("appOps.releases.hoursMinutes", { h, m: m % 60 }) : t("appOps.releases.hours", { n: h });
}

/** Bytes (assumed) -> «۱۰۰ مگابایت». */
export function formatMemoryBytes(bytes: number): string {
  return `${faNumber(bytes / BYTES_PER_MIB, { maximumFractionDigits: 0 })} ${fa.appOps.metrics.memUnit}`;
}

