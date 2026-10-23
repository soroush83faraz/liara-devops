"use client";

import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DbEngine } from "@/lib/contracts";
import type { CatalogView } from "@/lib/setup/catalog";
import type { Draft } from "@/lib/setup/draft";
import type { Recommendation } from "@/lib/setup/recommend";
import { engineName } from "@/lib/setup/text";
import { t } from "@/lib/i18n/t";
import { Field } from "./field";
import { PlanPicker } from "./plan-picker";

export function DbSection({
  draft,
  catalog,
  rec,
  onChange,
}: {
  draft: Draft;
  catalog: CatalogView;
  rec: Recommendation | undefined;
  onChange: (p: Partial<Draft>) => void;
}) {
  const engines = catalog.dbEngines.map((e) => e.engine);
  const engine = draft.dbEngine as DbEngine | "";
  const plans = catalog.dbPlans.filter((p) => !engine || !p.supports || p.supports.includes(engine));
  const sug = rec?.db;
  const canOffer = engines.length > 0 && catalog.dbPlans.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Switch
        label={t("setupFlow.choices.includeDb")}
        description={t("setupFlow.choices.includeDbHelp")}
        checked={draft.includeDb}
        disabled={!canOffer}
        onCheckedChange={(v) => onChange({ includeDb: v })}
      />
      {sug?.unavailable ? (
        <p className="flex items-start gap-2 text-sm leading-7 text-warn-ink">
          <Info aria-hidden className="mt-1 size-4 shrink-0" />
          {t("setupFlow.choices.dbUnavailable", { engine: engineName(sug.engine) })}
        </p>
      ) : null}
      {sug && sug.others.length > 0 ? (
        <p className="text-xs leading-6 text-muted">{t("setupFlow.choices.dbOthers", { engines: sug.others.map(engineName).join("، ") })}</p>
      ) : null}
      {draft.includeDb ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
          <Field label={t("setupFlow.choices.dbEngine")}>
            {({ id }) => (
              <Select
                id={id}
                value={engine}
                onValueChange={(v) => {
                  const first = catalog.dbPlans.find((p) => !p.supports || p.supports.includes(v));
                  onChange({ dbEngine: v as DbEngine, dbPlanId: first?.id ?? "" });
                }}
                options={engines.map((e) => ({ value: e, label: engineName(e) }))}
              />
            )}
          </Field>
          <Field label={t("setupFlow.choices.dbPlan")}>
            {() => (
              <PlanPicker
                name="db-plan"
                plans={plans}
                value={draft.dbPlanId}
                onChange={(id) => onChange({ dbPlanId: id })}
                recommendedId={sug && sug.engine === engine ? sug.plan?.chosen.id : undefined}
                smallerId={sug && sug.engine === engine ? sug.plan?.smaller?.id : undefined}
                biggerId={sug && sug.engine === engine ? sug.plan?.bigger?.id : undefined}
              />
            )}
          </Field>
          <Field label={t("setupFlow.choices.dbName")} help={t("setupFlow.choices.appNameHelp")}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} dir="ltr" className="text-start font-mono" placeholder={`${draft.appName || "app"}-db`} value={draft.dbName} onChange={(e) => onChange({ dbName: e.target.value.toLowerCase() })} />
            )}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium leading-7">{t("setupFlow.choices.dbKeys")}</legend>
            <p className="text-xs leading-6 text-muted">{t("setupFlow.choices.dbKeysHelp")}</p>
            {sug?.wire?.assumed ? <p className="text-xs leading-6 text-warn-ink">{t("setupFlow.choices.dbKeysAssumed")}</p> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(draft.dbEnvKeys).map(([field, key]) => (
                <label key={field} className="flex flex-col gap-1 text-xs text-muted">
                  <bdi dir="ltr" className="font-mono">{field}</bdi>
                  <Input
                    dir="ltr"
                    className="text-start font-mono"
                    value={key}
                    onChange={(e) => onChange({ dbEnvKeys: { ...draft.dbEnvKeys, [field]: e.target.value } })}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
