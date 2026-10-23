import { CircleAlert, CircleCheck, HeartCrack, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { ErrorScanSummary, Summary } from "@/lib/observability/summary";
import { cn } from "@/lib/utils";

function Tile({ label, value, hint, icon, tone, testId }: { label: string; value: string; hint?: string; icon: ReactNode; tone?: "ok" | "danger" | "warn"; testId: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4" data-testid={testId}>
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-5",
          tone === "ok" && "bg-ok-soft text-ok-ink",
          tone === "danger" && "bg-danger-soft text-danger-ink",
          tone === "warn" && "bg-warn-soft text-warn-ink",
          !tone && "bg-accent-soft text-accent-ink",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="text-2xl font-semibold leading-9 tabular-nums">{value}</dd>
        {hint ? <dd className="text-xs leading-5 text-muted">{hint}</dd> : null}
      </div>
    </div>
  );
}

function errorsTile(e: ErrorScanSummary): { value: string; hint: string; tone?: "warn" } {
  const heuristic = t("observability.summary.withErrorsHeuristic");
  if (e.kind === "unknown") return { value: t("observability.summary.errorsUnknown"), hint: `${t("observability.summary.errorsUnknownHint")} ${heuristic}` };
  const partial = e.scanned < e.total;
  return {
    value: partial ? t("observability.summary.atLeast", { count: e.withErrors }) : faNumber(e.withErrors),
    hint: `${partial ? t("observability.summary.scanPartial", { scanned: e.scanned, total: e.total }) : t("observability.summary.scanAll", { total: e.total })} ${heuristic}`,
    tone: e.withErrors > 0 ? "warn" : undefined,
  };
}

/** Total / healthy / unhealthy come from Liara status + our own probes. «دارای خطا» is a heuristic over log text, labelled as such. */
export function SummaryRow({ summary }: { summary: Summary }) {
  return (
    <dl aria-label={t("observability.summary.label")} className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-4">
      <Tile testId="obs-summary-total" label={t("observability.summary.total")} value={faNumber(summary.total)} icon={<Layers />} />
      <Tile testId="obs-summary-healthy" label={t("observability.summary.healthy")} value={faNumber(summary.healthy)} icon={<CircleCheck />} tone="ok" />
      <Tile testId="obs-summary-unhealthy" label={t("observability.summary.unhealthy")} value={faNumber(summary.unhealthy)} icon={<HeartCrack />} tone={summary.unhealthy > 0 ? "danger" : undefined} />
      <Tile testId="obs-summary-errors" label={t("observability.summary.withErrors")} {...errorsTile(summary.errors)} icon={<CircleAlert />} />
    </dl>
  );
}
