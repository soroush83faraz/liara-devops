"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog, DialogContent, Field, Input } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { appPath, postJson, useAction } from "@/lib/service/app-config/client";
import type { DomainAddedDto, DomainDto } from "@/lib/service/app-config/dto";
import { domainGuidance, normalizeDomainInput } from "@/lib/service/app-config/domain-doctor";
import { ErrorNotice } from "@/lib/service/app-config/ui/error-notice";
import { OpSummary } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";
import { DomainDoctor } from "./domain-doctor";

const PROBLEM_KEY = {
  empty: "appConfig.domains.input.empty",
  invalid: "appConfig.domains.input.invalid",
  wildcard: "appConfig.domains.input.wildcard",
  restricted_tld: "appConfig.domains.input.restricted",
  too_long: "appConfig.domains.input.invalid",
} as const;

type Step = 1 | 2 | 3;

/** Three steps: name -> confirm and add -> DNS records (Domain doctor). */
export function AddDomainDialog({ appName, onClose }: { appName: string; onClose: () => void }) {
  const done = useAfterMutation(appName);
  const action = useAction();
  const [step, setStep] = useState<Step>(1);
  const [input, setInput] = useState("");
  const [added, setAdded] = useState<DomainDto | null>(null);

  const norm = useMemo(() => normalizeDomainInput(input), [input]);
  const guidance = norm.ok ? domainGuidance(norm.name) : null;

  async function add() {
    if (!norm.ok) return;
    try {
      const res = await action.run(() => postJson<DomainAddedDto & { id?: string }>(appPath(appName, "domains"), { name: norm.name }));
      setAdded(res.domain ?? { id: res.id ?? "", name: norm.name, records: [] });
      done(t("appConfig.domains.add.toast"));
      setStep(3);
    } catch {
      /* the error is shown by `action.error` */
    }
  }

  const steps = [t("appConfig.domains.add.step1"), t("appConfig.domains.add.step2"), t("appConfig.domains.add.step3")];

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        size="lg"
        title={t("appConfig.domains.add.title")}
        footer={
          step === 1 ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button disabled={!norm.ok} onClick={() => setStep(2)}>
                {t("common.next")}
              </Button>
            </>
          ) : step === 2 ? (
            <>
              <Button variant="secondary" onClick={() => setStep(1)} disabled={action.pending}>
                {t("common.back")}
              </Button>
              <Button loading={action.pending} onClick={() => void add()}>
                {t("appConfig.domains.add.confirm")}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>{t("common.close")}</Button>
          )
        }
      >
        <div className="flex flex-col gap-4">
          <ol className="flex flex-wrap gap-3 text-sm" aria-label={t("appConfig.domains.add.stepsLabel")}>
            {steps.map((label, i) => {
              const n = (i + 1) as Step;
              const active = n === step;
              return (
                <li key={n} aria-current={active ? "step" : undefined} className={active ? "font-semibold text-accent" : "text-muted"}>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={`flex size-6 items-center justify-center rounded-full border text-xs ${n < step ? "border-ok bg-ok-soft text-ok-ink" : "border-border-strong/50"}`}
                    >
                      {n < step ? <Check className="size-3.5" /> : n}
                    </span>
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>

          {step === 1 ? (
            <div className="flex flex-col gap-3">
              <Field
                label={t("appConfig.domains.add.nameLabel")}
                hint={t("appConfig.domains.add.nameHint")}
                error={input.trim() && !norm.ok ? t(PROBLEM_KEY[norm.reason], { tld: norm.tld ?? "" }) : undefined}
              >
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    className="text-start font-mono"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="shop.example.ir"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                )}
              </Field>
              {norm.ok && norm.unicodeChanged ? (
                <p className="text-xs text-muted">
                  {t("appConfig.domains.add.asciiNote")}{" "}
                  <bdi dir="ltr" className="font-mono">
                    {norm.name}
                  </bdi>
                </p>
              ) : null}
              {guidance?.ir ? <p className="rounded-lg bg-accent-soft p-3 text-sm leading-7 text-accent-ink">{t("appConfig.domains.add.irNote")}</p> : null}
              <p className="text-xs leading-6 text-muted">{t("appConfig.domains.guide.limits")}</p>
            </div>
          ) : null}

          {step === 2 && norm.ok ? (
            <div className="flex flex-col gap-3">
              <OpSummary
                operation={t("appConfig.domains.add.operation")}
                target={norm.name}
                effect={t("appConfig.domains.add.effect")}
                risk={t("appConfig.domains.add.risk")}
                reversible="yes"
              />
              {action.error ? <ErrorNotice error={action.error} /> : null}
            </div>
          ) : null}

          {step === 3 && added ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-lg bg-surface-muted p-3 text-sm leading-7">{t("appConfig.domains.add.addedNote")}</p>
              <DomainDoctor domain={added} />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
