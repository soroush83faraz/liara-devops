"use client";

import { CircleCheck, CircleDashed, CircleHelp, CircleX, ShieldCheck, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Spinner } from "@/components/ui/spinner";
import { checkStatus, type DeployPlan, type VerificationCheckStatus } from "@/lib/contracts";
import { verificationHeadline } from "@/lib/copilot/verification";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { RunState } from "@/lib/setup/run-state";
import { errorText } from "@/lib/setup/text";
import { ease, spring } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { PlanSteps } from "./plan-steps";

const OUTCOME_TONE = { verified: "ok", not_verified: "warn", failed: "danger" } as const;

/** Only `passed` is green and only `failed` is red; unknown is amber, skipped is grey (never a red cross). */
const CHECK_VIEW: Record<VerificationCheckStatus, { Icon: typeof CircleCheck; icon: string; label: "setupFlow.run.checkPassed" | "setupFlow.run.checkFailed" | "setupFlow.run.checkUnknown" | "setupFlow.run.checkSkipped" }> = {
  passed: { Icon: CircleCheck, icon: "text-ok", label: "setupFlow.run.checkPassed" },
  failed: { Icon: CircleX, icon: "text-danger", label: "setupFlow.run.checkFailed" },
  unknown: { Icon: CircleHelp, icon: "text-warn", label: "setupFlow.run.checkUnknown" },
  skipped: { Icon: CircleDashed, icon: "text-muted", label: "setupFlow.run.checkSkipped" },
};

/** The execution result of the plan's steps, independent of verification. */
function executionState(plan: DeployPlan, run: RunState): "running" | "executed" | "incomplete" {
  if (run.phase !== "finished") return "running";
  if (run.error) return "incomplete";
  const views = plan.steps.map((s) => run.steps[s.id]?.status);
  return views.every((st) => st === "done" || st === "skipped") ? "executed" : "incomplete";
}

/** Hand-drawn check that strokes itself in: the one celebratory moment of the wizard (still under reduced motion). */
function SuccessMark() {
  return (
    <span aria-hidden className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
      <span className="absolute inset-0 rounded-full border border-ok/50 animate-hl-ping [animation-iteration-count:2]" />
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.2 4.2L19 7" pathLength={100} className="hl-draw" />
      </svg>
    </span>
  );
}

export function RunPanel({ plan, run, onRestart }: { plan: DeployPlan; run: RunState; onRestart: () => void }) {
  const v = run.verification;
  const finished = run.phase === "finished";
  const exec = executionState(plan, run);
  // The verification headline follows the outcome only (and re-checks that a «verified» outcome really has a passed check).
  const outcome = v ? (verificationHeadline(v).kind === "verified" ? "verified" : v.outcome === "failed" ? "failed" : "not_verified") : undefined;
  const total = plan.steps.length;
  const settled = plan.steps.filter((st) => {
    const status = run.steps[st.id]?.status;
    return status === "done" || status === "skipped" || status === "failed";
  }).length;
  const progress = total > 0 ? settled / total : 0;
  const failedRun = !!run.error || exec === "incomplete";
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-bold">{t("setupFlow.run.title")}</h2>
      <div className="flex flex-col gap-2.5 rounded-md border border-border bg-surface p-4">
        <div aria-live="polite" className="flex items-center gap-2 text-sm">
          {!finished ? <Spinner className="text-accent" /> : null}
          <span className="flex-1 text-muted">
            {run.phase === "approving" ? t("setupFlow.run.approving") : run.phase === "executing" ? t("setupFlow.run.executing") : finished ? "" : t("setupFlow.run.waiting")}
          </span>
          <span className="text-xs font-semibold tabular-nums text-foreground/80" aria-hidden>
            {faNumber(settled)} / {faNumber(total)}
          </span>
        </div>
        <div aria-hidden className={cn("relative h-1.5 overflow-hidden rounded-full", failedRun && finished ? "bg-danger-soft" : "bg-accent-soft")}>
          <div
            className={cn(
              "absolute inset-0 origin-right rounded-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ltr:origin-left",
              failedRun && finished ? "bg-danger" : exec === "executed" ? "bg-ok" : "bg-accent",
            )}
            style={{ transform: `scaleX(${progress})` }}
          />
          {!finished ? (
            <span className="absolute inset-y-0 start-0 w-1/3 animate-hl-sweep bg-linear-to-r from-transparent via-white/25 to-transparent rtl:[animation-direction:reverse]" />
          ) : null}
        </div>
        {!finished ? <p className="text-xs text-muted">{t("setupFlow.run.liveNote")}</p> : null}
      </div>

      <div aria-live="polite">
        <PlanSteps plan={plan} progress={run.steps} />
      </div>

      {finished && !run.error ? (
        <motion.section
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={spring.pop}
          data-testid="run-headline"
          data-exec={exec}
          className={cn(
            "flex items-start gap-4 rounded-md border p-4",
            exec === "executed" ? "border-ok/40 bg-ok-soft/40 shadow-[0_0_0_1px_color-mix(in_oklab,var(--ok)_18%,transparent),0_12px_36px_-12px_color-mix(in_oklab,var(--ok)_30%,transparent)]" : "border-warn/40 bg-warn-soft/50",
          )}
        >
          {exec === "executed" ? (
            <SuccessMark />
          ) : (
            <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn">
              <TriangleAlert className="size-6" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-[17px] font-bold">{exec === "executed" ? t("setupFlow.run.executedTitle") : t("setupFlow.run.notExecutedTitle")}</h3>
            <p className="text-sm leading-7 text-muted">{exec === "executed" ? t("setupFlow.run.executedBody") : t("setupFlow.run.notExecutedBody")}</p>
          </div>
        </motion.section>
      ) : null}

      {run.error ? (
        <ErrorBanner
          message={run.error.code === "stream_lost" ? t("setupFlow.run.streamLost") : run.error.message || errorText(run.error.code)}
          detail={run.error.code}
        />
      ) : null}

      {v ? (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: ease.out, delay: 0.12 }}
          className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
          aria-label={t("setupFlow.run.verifyTitle")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck aria-hidden className="size-4 text-muted" />
            <h3 className="text-base font-bold">{t("setupFlow.run.verifyTitle")}</h3>
            <Badge tone={OUTCOME_TONE[outcome ?? v.outcome]}>{t(`setupFlow.run.${outcome ?? v.outcome}`)}</Badge>
          </div>
          <ul className="flex flex-col divide-y divide-border text-sm leading-7">
            {v.checks.map((c) => {
              const st = checkStatus(c);
              const view = CHECK_VIEW[st];
              return (
                <li key={c.name} data-check-status={st} className="flex items-start gap-2 py-1.5">
                  <view.Icon aria-hidden className={`mt-1 size-4 shrink-0 ${view.icon}`} />
                  <span>
                    <bdi dir="ltr" className="font-mono text-xs">{c.name}</bdi> — {t(view.label)}
                    {c.detail ? <span className="text-muted"> ({c.detail})</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </motion.section>
      ) : null}

      {finished ? (
        <div className="flex flex-wrap gap-3">
          <Link href="/" className={buttonVariants({ variant: "primary" })}>
            {t("setupFlow.run.done")}
          </Link>
          {!v || outcome !== "verified" ? (
            <Button variant="secondary" onClick={onRestart}>
              {t("setupFlow.page.startOver")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
