"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { AnalyzeResponse } from "@/lib/setup/api-types";
import { activeEnvRows, type Draft } from "@/lib/setup/draft";
import { errorText } from "@/lib/setup/text";
import { t } from "@/lib/i18n/t";
import { AnalysisSummary } from "./analysis-summary";
import { ChoicesForm } from "./choices-form";
import { EnvChecklist } from "./env-checklist";
import { Section } from "./field";

/** Shown next to their own field (with a retry), not as a generic banner. */
const FIELD_SCOPED = new Set(["networks_unavailable", "bundle_price_unknown"]);

export function AnalysisStep({
  result,
  draft,
  showProblems,
  busy,
  error,
  onChange,
  onBack,
  onContinue,
  onRetryCatalog,
}: {
  result: AnalyzeResponse;
  draft: Draft;
  showProblems: boolean;
  busy: boolean;
  error: { code: string; field?: string } | null;
  onChange: (p: Partial<Draft>) => void;
  onBack: () => void;
  onContinue: () => void;
  onRetryCatalog: () => void;
}) {
  const { analysis, recommendation, catalog } = result;
  const wired = new Set(draft.includeDb ? Object.values(draft.dbEnvKeys) : []);
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold leading-9">{t("setupFlow.analysis.title")}</h2>
      <AnalysisSummary analysis={analysis} />
      {result.catalogError ? <ErrorBanner tone="warn" message={errorText(result.catalogError)} onRetry={onRetryCatalog} retrying={busy} /> : null}
      <ChoicesForm
        draft={draft}
        catalog={catalog}
        rec={recommendation}
        hasSource={!!result.sourceRef}
        showProblems={showProblems}
        planError={error}
        retrying={busy}
        onRetryCatalog={onRetryCatalog}
        onChange={onChange}
      />
      <Section title={t("setupFlow.env.title")}>
        <EnvChecklist rows={draft.env} wiredNames={wired} onChange={(env) => onChange({ env })} showMissing={showProblems && activeEnvRows(draft).length > 0} />
      </Section>
      {error && !FIELD_SCOPED.has(error.code) ? <ErrorBanner message={errorText(error.code)} detail={error.field} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          {t("setupFlow.page.back")}
        </Button>
        <Button onClick={onContinue} loading={busy} disabled={!catalog}>
          {t("setupFlow.page.continue")}
          <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
        </Button>
      </div>
    </div>
  );
}
