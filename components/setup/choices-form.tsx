"use client";

import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PLATFORMS, type Platform } from "@/lib/contracts";
import { bundleOptionLabel, bundlePriceKnown } from "@/lib/setup/cost-view";
import type { CatalogView } from "@/lib/setup/catalog";
import { draftProblems, type Draft, type DraftProblem } from "@/lib/setup/draft";
import type { Recommendation } from "@/lib/setup/recommend";
import { errorText, sizingText, platformName } from "@/lib/setup/text";
import { t } from "@/lib/i18n/t";
import { DbSection } from "./db-section";
import { Field, Section } from "./field";
import { PlanPicker } from "./plan-picker";

export function ChoicesForm({
  draft,
  catalog,
  rec,
  hasSource,
  showProblems,
  planError,
  retrying,
  onRetryCatalog,
  onChange,
}: {
  draft: Draft;
  catalog: CatalogView | undefined;
  rec: Recommendation | undefined;
  hasSource: boolean;
  showProblems: boolean;
  /** The last plan request failed with this code (field-scoped codes are shown next to their field). */
  planError?: { code: string; field?: string } | null;
  retrying?: boolean;
  onRetryCatalog?: () => void;
  onChange: (p: Partial<Draft>) => void;
}) {
  const problems = new Set<DraftProblem>(showProblems ? draftProblems(draft, hasSource) : []);
  const plan = catalog?.appPlans.find((p) => p.id === draft.planId);
  const bundles = plan?.bundles ?? [];
  const selectedBundle = bundles.find((b) => b.id === draft.bundlePlanId);
  const bundleError =
    planError?.code === "bundle_price_unknown" || (selectedBundle && !bundlePriceKnown(selectedBundle)) ? errorText("bundle_price_unknown") : undefined;
  const bundleHelp = bundles.some((b) => !bundlePriceKnown(b)) ? t("setupFlow.choices.bundleUnpricedHint") : undefined;
  const networksFailed = !!catalog?.networksError || planError?.code === "networks_unavailable";
  return (
    <div className="flex flex-col gap-6">
      <Section title={t("setupFlow.choices.title")}>
        <Field label={t("setupFlow.choices.appName")} help={t("setupFlow.choices.appNameHelp")} error={problems.has("appName") ? t("setupFlow.choices.appNameInvalid") : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} dir="ltr" className="text-start font-mono" value={draft.appName} onChange={(e) => onChange({ appName: e.target.value.toLowerCase() })} />
          )}
        </Field>
        <Field label={t("setupFlow.choices.platform")} help={t("setupFlow.choices.platformHelp")} error={problems.has("platform") ? t("setupFlow.choices.needsPlatform") : undefined}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={draft.platform}
              onValueChange={(v) => onChange({ platform: v as Platform })}
              options={PLATFORMS.map((p) => ({ value: p, label: platformName(p) }))}
            />
          )}
        </Field>
        <Field label={t("setupFlow.choices.port")} help={t("setupFlow.choices.portHelp")} error={problems.has("port") ? t("setupFlow.errors.invalid_port") : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} dir="ltr" inputMode="numeric" className="max-w-40 text-start font-mono" value={draft.port} onChange={(e) => onChange({ port: e.target.value.replace(/\D/g, "").slice(0, 5) })} />
          )}
        </Field>
      </Section>

      <Section title={t("setupFlow.choices.plan")}>
        <p className="text-sm leading-7 text-muted">{t("setupFlow.choices.planHelp")}</p>
        {catalog ? (
          <PlanPicker
            name="app-plan"
            plans={catalog.appPlans}
            value={draft.planId}
            onChange={(id) => onChange({ planId: id, bundlePlanId: "" })}
            recommendedId={rec?.appPlan?.chosen.id}
            smallerId={rec?.appPlan?.smaller?.id}
            biggerId={rec?.appPlan?.bigger?.id}
            belowNeed={rec?.appPlan?.belowNeed}
          />
        ) : (
          <p className="text-sm text-danger">{t("setupFlow.errors.catalog_unavailable")}</p>
        )}
        {problems.has("plan") ? <p role="alert" className="text-sm text-danger">{t("setupFlow.errors.unknown_plan")}</p> : null}
        {bundles.length > 0 ? (
          <Field label={t("setupFlow.choices.bundle")} help={bundleHelp} error={bundleError}>
            {({ id, describedBy, invalid }) => (
              <>
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={draft.bundlePlanId || "none"}
                  onValueChange={(v) => onChange({ bundlePlanId: v === "none" ? "" : v })}
                  // A bundle with no price is listed as «قیمت نامشخص» and cannot be picked: it would be costed as free.
                  options={[{ value: "none", label: t("common.none") }, ...bundles.map((b) => ({ value: b.id, label: bundleOptionLabel(b), disabled: !bundlePriceKnown(b) }))]}
                />
                {planError?.code === "bundle_price_unknown" && onRetryCatalog ? (
                  <Button variant="secondary" size="sm" className="self-start" onClick={onRetryCatalog} loading={retrying}>
                    {t("common.retry")}
                  </Button>
                ) : null}
              </>
            )}
          </Field>
        ) : null}
        {rec && rec.appPlan ? (
          <details className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
            <summary className="cursor-pointer font-medium leading-7">{t("setupFlow.sizing.title")}</summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 leading-7">
              {[...rec.needs.reasons, ...rec.appPlan.reasons].map((r, i) => (
                <li key={i}>{sizingText(r, rec.needs)}</li>
              ))}
              <li className="text-muted">{t("setupFlow.sizing.estimate")}</li>
            </ul>
          </details>
        ) : null}
      </Section>

      {catalog && (catalog.networks.length > 0 || networksFailed) ? (
        <Section title={t("setupFlow.choices.network")}>
          {networksFailed ? (
            <ErrorBanner tone="warn" title={t("setupFlow.choices.networksFailedTitle")} message={errorText("networks_unavailable")} onRetry={onRetryCatalog} retrying={retrying} />
          ) : null}
          {catalog.networks.length > 0 ? <Field label={t("setupFlow.choices.network")} help={t("setupFlow.choices.networkHelp")}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={draft.networkId || "none"}
                onValueChange={(v) => onChange({ networkId: v === "none" ? "" : v })}
                options={[{ value: "none", label: t("setupFlow.choices.networkNone") }, ...catalog.networks.map((n) => ({ value: n.id, label: n.name }))]}
              />
            )}
          </Field> : null}
          {draft.includeDb && !draft.networkId ? <p className="text-xs leading-6 text-warn-ink">{t("setupFlow.choices.networkWarn")}</p> : null}
        </Section>
      ) : null}

      {catalog ? (
        <Section title={t("setupFlow.choices.db")}>
          <DbSection draft={draft} catalog={catalog} rec={rec} onChange={onChange} />
        </Section>
      ) : null}

      <Section title={t("setupFlow.choices.moreTitle")}>
        <Field label={t("setupFlow.choices.dockerImage")} help={t("setupFlow.choices.dockerImageHelp")} error={problems.has("deploySource") ? t("setupFlow.choices.needsDeploySource") : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} dir="ltr" className="text-start font-mono" value={draft.dockerImage} onChange={(e) => onChange({ dockerImage: e.target.value })} />
          )}
        </Field>
        <Field label={t("setupFlow.choices.domain")} help={t("setupFlow.choices.domainHelp")} error={problems.has("domain") ? t("setupFlow.choices.domainInvalid") : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} dir="ltr" className="text-start font-mono" value={draft.domain} onChange={(e) => onChange({ domain: e.target.value })} />
          )}
        </Field>
      </Section>
    </div>
  );
}
