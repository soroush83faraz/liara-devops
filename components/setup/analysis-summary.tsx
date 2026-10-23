import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyValueList, type KeyValueItem } from "@/components/ui/key-value-list";
import { t } from "@/lib/i18n/t";
import type { ProjectAnalysis } from "@/lib/setup/types";
import { confidenceLevel, engineName, platformName, reasonText, warningText } from "@/lib/setup/text";

function facts(a: ProjectAnalysis): KeyValueItem[] {
  const items: KeyValueItem[] = [];
  if (a.framework) items.push({ key: t("setupFlow.analysis.framework"), value: a.framework, ltr: true });
  if (a.nodeVersion) items.push({ key: t("setupFlow.analysis.nodeVersion"), value: a.nodeVersion, ltr: true });
  if (a.pythonVersion) items.push({ key: t("setupFlow.analysis.pythonVersion"), value: a.pythonVersion, ltr: true });
  if (a.packageManager) items.push({ key: t("setupFlow.analysis.packageManager"), value: a.packageManager, ltr: true });
  if (a.startCommand) items.push({ key: t("setupFlow.analysis.startCommand"), value: a.startCommand, ltr: true });
  if (a.buildCommand) items.push({ key: t("setupFlow.analysis.buildCommand"), value: a.buildCommand, ltr: true });
  if (a.port) {
    items.push({
      key: t("setupFlow.analysis.port"),
      value: (
        <>
          <bdi dir="ltr" className="font-mono">{a.port}</bdi> <span className="text-xs text-muted">({t("setupFlow.analysis.portDetected")})</span>
        </>
      ),
    });
  }
  if (a.staticSite) items.push({ key: t("setupFlow.analysis.staticSite"), value: t("common.yes") });
  if (a.hasDockerfile) items.push({ key: t("setupFlow.analysis.dockerfile"), value: t("common.yes") });
  if (a.stats.fileCount > 0) items.push({ key: t("setupFlow.analysis.factsTitle"), value: t("setupFlow.analysis.files", { count: a.stats.fileCount }) });
  return items;
}

export function AnalysisSummary({ analysis: a }: { analysis: ProjectAnalysis }) {
  const unknown = a.platform === "unknown";
  const level = confidenceLevel(a.confidence);
  const platform = platformName(a.platform);
  const items = facts(a);
  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>{t("setupFlow.analysis.detected")}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={unknown ? "warn" : "accent"} className="text-sm">
            {unknown ? <TriangleAlert aria-hidden className="size-3.5" /> : <CircleCheck aria-hidden className="size-3.5" />}
            {platform}
          </Badge>
          {!unknown ? (
            <Badge tone={level === "High" ? "ok" : level === "Medium" ? "warn" : "danger"}>
              {t("setupFlow.analysis.confidenceLabel", { level: t(`setupFlow.analysis.confidence${level}`), percent: Math.round(a.confidence * 100) })}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <details className="hl-disclosure rounded-sm border border-border bg-surface-muted/60 p-3" open={unknown}>
          <summary className="cursor-pointer text-[15px] font-medium leading-7">
            {unknown ? t("setupFlow.analysis.whyUnknown") : t("setupFlow.analysis.whyTitle", { platform })}
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 ps-5 text-sm leading-7">
            {a.reasons.map((r, i) => (
              <li key={i}>{reasonText(r)}</li>
            ))}
          </ul>
        </details>

        {items.length > 0 ? <KeyValueList items={items} /> : null}

        {a.requiresDatabase.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <h4 className="text-sm font-semibold">{t("setupFlow.analysis.databasesTitle")}</h4>
            <ul className="flex flex-wrap gap-2">
              {a.requiresDatabase.map((d) => (
                <li key={d.engine}>
                  <Badge tone="neutral">{t("setupFlow.analysis.databaseEvidence", { engine: engineName(d.engine), evidence: d.evidence })}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-semibold">{t("setupFlow.analysis.warningsTitle")}</h4>
          {a.warnings.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Info aria-hidden className="size-4" />
              {t("setupFlow.analysis.noWarnings")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {a.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2 rounded-sm bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
                  <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
                  <span>{warningText(w)}</span>
                </li>
              ))}
            </ul>
          )}
          {a.monorepoCandidates.length > 1 ? (
            <ul className="flex flex-wrap gap-2 text-xs">
              {a.monorepoCandidates.map((c) => (
                <li key={c}>
                  <bdi dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono">{c}</bdi>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
