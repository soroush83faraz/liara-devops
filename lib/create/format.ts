// Display helpers for plan specs and sizes (Persian digits, strings from the createFlow namespace).
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";

export function formatRam(ramMb: number | undefined): string | undefined {
  if (ramMb === undefined) return undefined;
  return ramMb >= 1024
    ? t("createFlow.plan.ramGb", { value: faNumber(Math.round((ramMb / 1024) * 100) / 100) })
    : t("createFlow.plan.ramMb", { value: faNumber(ramMb) });
}

export const formatCores = (cpu: number | undefined): string | undefined =>
  cpu === undefined ? undefined : t("createFlow.plan.cores", { value: faNumber(cpu) });

export const formatDisk = (gb: number | undefined): string | undefined =>
  gb === undefined ? undefined : t("createFlow.plan.diskGb", { value: faNumber(gb) });

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${faNumber(Math.max(1, Math.round(n / 1024)))} ${t("createFlow.common.kb")}`;
  return `${faNumber(Math.round((n / (1024 * 1024)) * 10) / 10)} ${t("createFlow.common.mb")}`;
}
