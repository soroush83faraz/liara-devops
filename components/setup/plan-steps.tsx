import { CircleCheck, CircleDashed, CircleX, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type { DeployPlan } from "@/lib/contracts";
import { faPrice } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { stepLabel } from "@/lib/setup/explain";
import type { StepView } from "@/lib/setup/run-state";

const ICON = {
  pending: <CircleDashed aria-hidden className="size-5 text-muted" />,
  running: <Spinner className="size-5 text-accent" />,
  done: <CircleCheck aria-hidden className="size-5 text-ok" />,
  failed: <CircleX aria-hidden className="size-5 text-danger" />,
  skipped: <Minus aria-hidden className="size-5 text-muted" />,
} as const;

const LABEL = {
  pending: "setupFlow.run.stepPending",
  running: "setupFlow.run.stepRunning",
  done: "setupFlow.run.stepDone",
  failed: "setupFlow.run.stepFailed",
  skipped: "setupFlow.run.stepSkipped",
} as const;

/** Numbered step list. With `progress`, each row shows its live status (icon + text, never colour alone). */
export function PlanSteps({ plan, progress }: { plan: DeployPlan; progress?: Record<string, StepView> }) {
  return (
    <ol className="flex flex-col gap-2">
      {plan.steps.map((s) => {
        const view = progress ? (progress[s.id] ?? { status: "pending" as const }) : undefined;
        const billed = s.kind === "create_app" || s.kind === "create_db";
        return (
          <li key={s.id} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
            {view ? <span className="mt-0.5 shrink-0">{ICON[view.status]}</span> : <span className="mt-0.5 w-5 shrink-0 text-center text-sm font-semibold text-muted">{s.id.slice(1)}</span>}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-7">{stepLabel(s)}</p>
              {view ? (
                <p className="text-xs leading-6 text-muted">
                  {t(LABEL[view.status])}
                  {view.detail ? <> — <bdi>{view.detail}</bdi></> : null}
                </p>
              ) : null}
            </div>
            {billed ? (
              <Badge tone="warn" className="shrink-0">
                {faPrice(s.cost.perMonthToman)} {t("common.perMonth")}
              </Badge>
            ) : (
              <Badge tone="neutral" className="shrink-0">{t("setupFlow.steps.free")}</Badge>
            )}
          </li>
        );
      })}
    </ol>
  );
}
