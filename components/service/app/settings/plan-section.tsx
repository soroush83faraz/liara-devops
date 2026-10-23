"use client";

import { ArrowDown, ArrowUp, Info, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Field, Select } from "@/components/ui";
import { runOp } from "@/lib/client/ops";
import { faNumber, faPrice } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { PlanOption, SettingsDto } from "@/lib/service/app-config/dto";
import { comparePlans } from "@/lib/service/app-config/plans";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";
import { SettingsCard } from "./settings-card";

function planSpec(p: PlanOption): string {
  const parts: string[] = [];
  if (p.ramGb !== undefined) parts.push(t("appConfig.settings.plan.ram", { ram: faNumber(p.ramGb) }));
  if (p.cpu !== undefined) parts.push(t("appConfig.settings.plan.cpu", { cpu: faNumber(p.cpu) }));
  return parts.join("، ");
}

/** `resize` (tier 2, billed): pick a plan, see the cost comparison, then type the app name. */
export function PlanSection({ appName, settings }: { appName: string; settings: SettingsDto }) {
  const done = useAfterMutation(appName);
  const plans = settings.plans.unavailable ? null : settings.plans.data;
  const current = plans?.find((p) => p.id === settings.planID);
  const [selected, setSelected] = useState<string>("");
  const [open, setOpen] = useState(false);
  const target = plans?.find((p) => p.id === selected);
  const cmp = useMemo(
    () => (target ? comparePlans(current, settings.hourlyPrice, target) : null),
    [current, settings.hourlyPrice, target],
  );

  return (
    <SettingsCard id="plan" title={t("appConfig.settings.plan.title")} description={t("appConfig.settings.plan.desc")}>
      <p className="text-sm">
        {t("appConfig.settings.plan.currentLabel")}{" "}
        <bdi dir="ltr" className="font-mono font-semibold">
          {settings.planID ?? t("common.unknown")}
        </bdi>
        {current ? <span className="text-muted"> — {planSpec(current)}</span> : null}
      </p>

      {!plans ? (
        <p className="text-sm text-muted">{t("appConfig.settings.plan.unavailable")}</p>
      ) : (
        <>
          <Field label={t("appConfig.settings.plan.pick")}>
            {(p) => (
              <Select
                id={p.id}
                value={selected}
                onValueChange={setSelected}
                placeholder={t("appConfig.settings.plan.placeholder")}
                options={plans.map((o) => ({
                  value: o.id,
                  disabled: o.id === settings.planID || !o.available,
                  label: `${o.id} — ${planSpec(o)} — ${o.priceKnown && o.pricePerMonth !== undefined ? t("appConfig.settings.plan.monthly", { price: faPrice(o.pricePerMonth) }) : t("appConfig.settings.plan.priceUnknown")}${o.id === settings.planID ? ` (${t("appConfig.settings.plan.currentTag")})` : ""}`,
                }))}
              />
            )}
          </Field>

          {target && cmp ? (
            <div className="flex flex-col gap-2 rounded-sm bg-surface-muted p-3 text-sm leading-7" aria-live="polite">
              <p className="font-medium">
                {target.priceKnown && target.pricePerHour !== undefined && target.pricePerMonth !== undefined
                  ? t("appConfig.settings.plan.newPrice", { hourly: faPrice(target.pricePerHour), monthly: faPrice(target.pricePerMonth) })
                  : t("appConfig.settings.plan.newPriceUnknown")}
              </p>
              {cmp.deltaMonthly !== undefined ? (
                <p className="flex items-center gap-1.5">
                  {cmp.direction === "up" ? <ArrowUp aria-hidden className="size-4 text-warn" /> : cmp.direction === "down" ? <ArrowDown aria-hidden className="size-4 text-ok" /> : <Minus aria-hidden className="size-4" />}
                  {cmp.direction === "up"
                    ? t("appConfig.settings.plan.moreExpensive", { amount: faPrice(Math.abs(cmp.deltaMonthly)) })
                    : cmp.direction === "down"
                      ? t("appConfig.settings.plan.cheaper", { amount: faPrice(Math.abs(cmp.deltaMonthly)) })
                      : t("appConfig.settings.plan.samePrice")}
                </p>
              ) : (
                <p className="text-muted">{t("appConfig.settings.plan.noComparison")}</p>
              )}
              {cmp.approximate ? <p className="text-xs text-muted">{t("appConfig.settings.plan.approx")}</p> : null}
              <p className="flex items-start gap-1.5 text-xs text-muted">
                <Info aria-hidden className="mt-1 size-3.5 shrink-0" />
                {t("appConfig.settings.plan.downtime")}
              </p>
            </div>
          ) : null}

          <Button className="self-start" disabled={!target} onClick={() => setOpen(true)}>
            {t("appConfig.settings.plan.apply")}
          </Button>
        </>
      )}

      {open && target ? (
        <OpDialog
          open
          onOpenChange={setOpen}
          title={t("appConfig.settings.plan.dialogTitle")}
          operation={t("appConfig.settings.plan.operation", { from: settings.planID ?? t("common.unknown"), to: target.id })}
          target={appName}
          effect={t("appConfig.settings.plan.effect")}
          risk={t("appConfig.settings.plan.risk")}
          reversible="partly"
          cost={
            target.priceKnown && target.pricePerHour !== undefined && target.pricePerMonth !== undefined
              ? t("create.costLine", { hourly: faPrice(target.pricePerHour), monthly: faPrice(target.pricePerMonth) })
              : t("appConfig.settings.plan.priceUnknown")
          }
          typedName={appName}
          confirmLabel={t("appConfig.settings.plan.confirm")}
          onConfirm={async () => {
            await runOp({
              params: { type: "resize", resource: { kind: "app", name: appName }, planId: target.id },
              typedName: appName,
            });
            setSelected("");
            done(t("appConfig.settings.plan.toast"));
          }}
        />
      ) : null}
    </SettingsCard>
  );
}
