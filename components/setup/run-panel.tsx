"use client";

import { CircleCheck, CircleDashed, CircleHelp, CircleX } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Spinner } from "@/components/ui/spinner";
import { checkStatus, type DeployPlan, type VerificationCheckStatus } from "@/lib/contracts";
import { verificationHeadline } from "@/lib/copilot/verification";
import { t } from "@/lib/i18n/t";
import type { RunState } from "@/lib/setup/run-state";
import { errorText } from "@/lib/setup/text";
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

export function RunPanel({ plan, run, onRestart }: { plan: DeployPlan; run: RunState; onRestart: () => void }) {
  const v = run.verification;
  const finished = run.phase === "finished";
  const exec = executionState(plan, run);
  // The verification headline follows the outcome only (and re-checks that a «verified» outcome really has a passed check).
  const outcome = v ? (verificationHeadline(v).kind === "verified" ? "verified" : v.outcome === "failed" ? "failed" : "not_verified") : undefined;
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold leading-9">{t("setupFlow.run.title")}</h2>
      <div aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
        {!finished ? <Spinner /> : null}
        <span>
          {run.phase === "approving" ? t("setupFlow.run.approving") : run.phase === "executing" ? t("setupFlow.run.executing") : finished ? "" : t("setupFlow.run.waiting")}
        </span>
      </div>
      {!finished ? <p className="text-xs text-muted">{t("setupFlow.run.liveNote")}</p> : null}

      <div aria-live="polite">
        <PlanSteps plan={plan} progress={run.steps} />
      </div>

      {finished && !run.error ? (
        <section data-testid="run-headline" data-exec={exec} className="flex flex-col gap-1 rounded-xl border border-border p-4">
          <h3 className="text-base font-semibold leading-8">{exec === "executed" ? t("setupFlow.run.executedTitle") : t("setupFlow.run.notExecutedTitle")}</h3>
          <p className="text-sm leading-7 text-muted">{exec === "executed" ? t("setupFlow.run.executedBody") : t("setupFlow.run.notExecutedBody")}</p>
        </section>
      ) : null}

      {run.error ? (
        <ErrorBanner
          message={run.error.code === "stream_lost" ? t("setupFlow.run.streamLost") : run.error.message || errorText(run.error.code)}
          detail={run.error.code}
        />
      ) : null}

      {v ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border p-4" aria-label={t("setupFlow.run.verifyTitle")}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold leading-8">{t("setupFlow.run.verifyTitle")}</h3>
            <Badge tone={OUTCOME_TONE[outcome ?? v.outcome]}>{t(`setupFlow.run.${outcome ?? v.outcome}`)}</Badge>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm leading-7">
            {v.checks.map((c) => {
              const st = checkStatus(c);
              const view = CHECK_VIEW[st];
              return (
                <li key={c.name} data-check-status={st} className="flex items-start gap-2">
                  <view.Icon aria-hidden className={`mt-1 size-4 shrink-0 ${view.icon}`} />
                  <span>
                    <bdi dir="ltr" className="font-mono text-xs">{c.name}</bdi> — {t(view.label)}
                    {c.detail ? <span className="text-muted"> ({c.detail})</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
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
