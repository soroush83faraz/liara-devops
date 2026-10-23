"use client";

import { Clock, Info, Receipt, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TypeToConfirm } from "@/components/ui/type-to-confirm";
import { faPrice, relativeTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { PlanResponse } from "@/lib/setup/api-types";
import { missingUserValues, type Draft } from "@/lib/setup/draft";
import { stepLabel } from "@/lib/setup/explain";
import { AnimatedNumber } from "@/lib/ui/motion";
import { PlanSteps } from "./plan-steps";

export function ReviewStep({
  plan,
  draft,
  expired,
  costIncomplete = false,
  onBack,
  onConfirm,
}: {
  plan: PlanResponse;
  draft: Draft;
  expired: boolean;
  /** A billed component (e.g. the chosen bundle) has no known price: the total is a lower bound, not final. */
  costIncomplete?: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const missing = missingUserValues(draft, plan.userValueKeys);
  const hasDb = plan.plan.steps.some((s) => s.kind === "create_db");
  const { totals } = plan.costs;
  const billed = plan.plan.steps.filter((st) => st.kind === "create_app" || st.kind === "create_db");
  const atLeast = costIncomplete ? `${t("setupFlow.review.totalAtLeast")} ` : "";
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-bold">{t("setupFlow.review.title")}</h2>
      <Card className="p-4 sm:p-5">
        <h3 className="text-[15px] font-bold">{t("setupFlow.review.summaryTitle")}</h3>
        <p className="mt-2 text-[15px] leading-8">{plan.explanation.summary}</p>
        {plan.explanation.notes.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-7 text-muted">
            {plan.explanation.notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2">
                <span aria-hidden className="mt-3 size-1 shrink-0 rounded-full bg-border-strong" />
                {n}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-bold">{t("setupFlow.review.stepsTitle")}</h3>
        <PlanSteps plan={plan.plan} />
      </section>

      <section aria-label={t("setupFlow.review.costTitle")} className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
          <Receipt aria-hidden className="size-4 text-muted" />
          <h3 className="text-base font-bold">{t("setupFlow.review.costTitle")}</h3>
        </div>
        {billed.length > 0 ? (
          <ul className="flex flex-col px-4 py-2 sm:px-5">
            {billed.map((st) => (
              <li key={st.id} className="flex items-baseline gap-3 border-b border-dashed border-border py-2 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 text-foreground/85">{stepLabel(st)}</span>
                <span className="shrink-0 tabular-nums text-muted">{faPrice(st.cost.perMonthToman)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 border-t border-border bg-surface-muted/60 px-4 py-3.5 sm:px-5">
          <dt className="text-sm font-medium">
            {t("setupFlow.review.total")} ({t("setupFlow.review.perMonth")})
          </dt>
          <dd className="text-xl font-bold">
            {atLeast}
            <AnimatedNumber value={totals.perMonthToman} format={faPrice} countUp />
          </dd>
          <dt className="text-sm text-muted">
            {t("setupFlow.review.total")} ({t("setupFlow.review.perHour")})
          </dt>
          <dd className="text-sm tabular-nums text-muted">
            {atLeast}
            {faPrice(totals.perHourToman)}
          </dd>
        </dl>
        {costIncomplete ? (
          <p role="note" className="flex items-start gap-2 border-t border-warn/25 bg-warn-soft px-4 py-2.5 text-sm leading-7 text-warn-ink sm:px-5">
            <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
            {t("setupFlow.review.totalIncomplete")}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-bold">{t("setupFlow.domainSteps.title")}</h3>
        <p className="flex items-start gap-2 text-sm leading-7 text-muted">
          <Info aria-hidden className="mt-1 size-4 shrink-0" />
          {t("setupFlow.domainSteps.note")}
        </p>
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm leading-7 marker:text-muted">
          {plan.explanation.domain.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ol>
      </section>

      {missing.length > 0 ? <p role="alert" className="text-sm text-danger">{t("setupFlow.review.valuesMissing")}</p> : null}
      <p className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Clock aria-hidden className="size-3.5" />
        {t("setupFlow.review.expires", { time: relativeTime(plan.expiresAt) })}
      </p>
      {expired ? <p role="alert" className="text-sm text-danger">{t("setupFlow.review.expired")}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onBack}>
          {t("setupFlow.review.editChoices")}
        </Button>
        <Button onClick={() => setOpen(true)} disabled={missing.length > 0 || expired}>
          {t("setupFlow.review.confirm")}
        </Button>
      </div>

      <TypeToConfirm
        open={open}
        onOpenChange={setOpen}
        name={plan.plan.app}
        title={t("setupFlow.review.confirmTitle")}
        description={t("setupFlow.review.confirmDescription", { dbPart: hasDb ? t("setupFlow.review.confirmDescriptionDb") : "" })}
        confirmLabel={t("setupFlow.review.confirmButton")}
        onConfirm={onConfirm}
      >
        <p className="rounded-sm border border-warn/25 bg-warn-soft p-3 text-sm font-medium leading-7 text-warn-ink">
          {t(costIncomplete ? "setupFlow.review.costLineAtLeast" : "setupFlow.review.costLine", { month: Math.round(totals.perMonthToman) })}
        </p>
      </TypeToConfirm>
    </div>
  );
}
