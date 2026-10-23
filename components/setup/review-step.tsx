"use client";

import { Info } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TypeToConfirm } from "@/components/ui/type-to-confirm";
import { faPrice, relativeTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { PlanResponse } from "@/lib/setup/api-types";
import { missingUserValues, type Draft } from "@/lib/setup/draft";
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
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold leading-9">{t("setupFlow.review.title")}</h2>
      <Card>
        <CardHeader>
          <CardTitle>{t("setupFlow.review.summaryTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-[15px] leading-8">{plan.explanation.summary}</p>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm leading-7 text-muted">
            {plan.explanation.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold leading-8">{t("setupFlow.review.stepsTitle")}</h3>
        <PlanSteps plan={plan.plan} />
      </section>

      <section aria-label={t("setupFlow.review.costTitle")} className="rounded-xl border border-border bg-surface-muted p-4">
        <h3 className="text-base font-semibold leading-8">{t("setupFlow.review.costTitle")}</h3>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
          <dt>{t("setupFlow.review.total")} ({t("setupFlow.review.perMonth")})</dt>
          <dd className="font-semibold">{costIncomplete ? `${t("setupFlow.review.totalAtLeast")} ` : ""}{faPrice(totals.perMonthToman)}</dd>
          <dt className="text-muted">{t("setupFlow.review.total")} ({t("setupFlow.review.perHour")})</dt>
          <dd className="text-muted">{costIncomplete ? `${t("setupFlow.review.totalAtLeast")} ` : ""}{faPrice(totals.perHourToman)}</dd>
        </dl>
        {costIncomplete ? <p role="note" className="mt-2 text-sm leading-7 text-warn-ink">{t("setupFlow.review.totalIncomplete")}</p> : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold leading-8">{t("setupFlow.domainSteps.title")}</h3>
        <p className="flex items-start gap-2 text-sm leading-7 text-muted">
          <Info aria-hidden className="mt-1 size-4 shrink-0" />
          {t("setupFlow.domainSteps.note")}
        </p>
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm leading-7">
          {plan.explanation.domain.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ol>
      </section>

      {missing.length > 0 ? <p role="alert" className="text-sm text-danger">{t("setupFlow.review.valuesMissing")}</p> : null}
      <p className="text-xs text-muted">{t("setupFlow.review.expires", { time: relativeTime(plan.expiresAt) })}</p>
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
        <p className="rounded-lg bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
          {t(costIncomplete ? "setupFlow.review.costLineAtLeast" : "setupFlow.review.costLine", { month: Math.round(totals.perMonthToman) })}
        </p>
      </TypeToConfirm>
    </div>
  );
}
