"use client";

import { CircleCheck, CircleDashed, CircleX, Minus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type { DeployPlan } from "@/lib/contracts";
import { faNumber, faPrice } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { stepLabel } from "@/lib/setup/explain";
import type { StepView } from "@/lib/setup/run-state";
import { spring } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

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
          <li
            key={s.id}
            data-step-status={view?.status}
            className={cn(
              "flex items-start gap-3 rounded-md border bg-surface p-3 transition-[border-color,box-shadow,opacity] duration-300",
              view?.status === "running" ? "border-accent/60 shadow-[var(--glow-accent)]" : view?.status === "failed" ? "border-danger/50" : "border-border",
              view?.status === "pending" && "opacity-75",
            )}
          >
            {view ? (
              <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={view.status}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={spring.pop}
                    className="flex"
                  >
                    {ICON[view.status]}
                  </motion.span>
                </AnimatePresence>
              </span>
            ) : (
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-muted">
                {/^\d+$/.test(s.id.slice(1)) ? faNumber(Number(s.id.slice(1))) : s.id.slice(1)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-7">{stepLabel(s)}</p>
              {view ? (
                <p className={cn("text-xs leading-6", view.status === "running" ? "text-accent-ink" : view.status === "failed" ? "text-danger" : "text-muted")}>
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
