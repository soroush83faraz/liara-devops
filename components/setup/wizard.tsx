"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ui/error-banner";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { Answers } from "@/lib/setup/analyze";
import type { AnalyzeResponse, PlanResponse } from "@/lib/setup/api-types";
import { SetupApiError, analyzeAnswers, analyzeFile, reanalyze, requestPlan, runProposal } from "@/lib/setup/client";
import {
  collectUserValues,
  draftFromRecommendation,
  draftProblems,
  draftToChoices,
  missingUserValues,
  type Draft,
} from "@/lib/setup/draft";
import { hasUnpricedBundle } from "@/lib/setup/cost-view";
import { initialRun, reduceRun } from "@/lib/setup/run-state";
import { errorText } from "@/lib/setup/text";
import { cn } from "@/lib/utils";
import { AnalysisStep } from "./analysis-step";
import { ReviewStep } from "./review-step";
import { RunPanel } from "./run-panel";
import { StartStep } from "./start-step";

type Phase = "start" | "analysis" | "review" | "run";
const PHASES: Array<{ id: Phase; label: "stepStart" | "stepAnalysis" | "stepReview" | "stepRun" }> = [
  { id: "start", label: "stepStart" },
  { id: "analysis", label: "stepAnalysis" },
  { id: "review", label: "stepReview" },
  { id: "run", label: "stepRun" },
];

/** A clock that ticks while the plan is on screen, so expiry shows up without a reload. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const apiError = (e: unknown): { code: string; field?: string } =>
  e instanceof SetupApiError ? { code: e.code, field: e.field } : { code: "network" };

export function SetupWizard() {
  const [phase, setPhase] = useState<Phase>("start");
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  // The draft holds env VALUES the user typed. It lives only in this component's state.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [planError, setPlanError] = useState<{ code: string; field?: string } | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [run, dispatch] = useReducer(reduceRun, initialRun);
  const abort = useRef<AbortController | null>(null);
  const now = useNow(10_000);

  useEffect(() => () => abort.current?.abort(), []);
  const signal = () => {
    abort.current?.abort();
    abort.current = new AbortController();
    return abort.current.signal;
  };

  const accept = useCallback((res: AnalyzeResponse, fileName?: string) => {
    setResult(res);
    setDraft(draftFromRecommendation(res.analysis, res.recommendation, res.catalog, fileName ?? res.fileName));
    setShowProblems(false);
    setPlanError(null);
    setPlan(null);
    setPhase("analysis");
  }, []);

  async function start<T>(job: () => Promise<T>, then: (v: T) => void) {
    setBusy(true);
    setStartError(null);
    try {
      then(await job());
    } catch (e) {
      const code = apiError(e).code;
      setStartError(e instanceof SetupApiError && e.message && code === "unknown" ? e.message : errorText(code));
    } finally {
      setBusy(false);
    }
  }

  const onFile = (file: File) => start(() => analyzeFile(file, signal()), (res) => accept(res, file.name));
  const lastAnswers = useRef<{ answers: Answers; description: string } | null>(null);
  const onAnswers = (answers: Answers, description: string) => {
    lastAnswers.current = { answers, description };
    return start(() => analyzeAnswers(answers, description, signal()), (res) => accept(res));
  };

  /** Plans/networks could not be read from Liara: ask again (the stored upload is reused, not re-uploaded). */
  async function retryCatalog() {
    if (!result) return;
    const saved = lastAnswers.current;
    const again = result.sourceRef ? () => reanalyze(result.sourceRef as string, signal()) : saved ? () => analyzeAnswers(saved.answers, saved.description, signal()) : null;
    if (!again) return;
    setBusy(true);
    try {
      const res = await again();
      if (result.catalog) {
        // Keep what the user already chose and typed; only the catalog (and the recommendation) is refreshed.
        setResult({ ...res, fileName: res.fileName ?? result.fileName });
        setPlanError(null);
        setPlan(null);
      } else {
        accept(res, result.fileName);
      }
    } catch (e) {
      setPlanError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function toReview() {
    if (!result || !draft) return;
    if (draftProblems(draft, !!result.sourceRef).length > 0 || missingUserValues(draft).length > 0) {
      setShowProblems(true);
      return;
    }
    setBusy(true);
    setPlanError(null);
    try {
      const res = await requestPlan(
        { choices: draftToChoices(draft), ...(result.sourceRef ? { sourceRef: result.sourceRef } : { analysis: result.analysis }) },
        signal(),
      );
      setPlan(res);
      setPhase("review");
    } catch (e) {
      setPlanError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  function startRun() {
    if (!plan || !draft) return;
    const s = signal();
    dispatch({ kind: "reset" });
    setPhase("run");
    runProposal({
      proposalId: plan.proposalId,
      typedName: plan.plan.app,
      userValues: collectUserValues(draft, plan.userValueKeys),
      onEvent: dispatch,
      signal: s,
    }).catch((e: unknown) => {
      if (s.aborted) return;
      const err = apiError(e);
      dispatch({ kind: "error", code: err.code, message: errorText(err.code) });
    });
  }

  function startOver() {
    abort.current?.abort();
    setResult(null);
    setDraft(null);
    setPlan(null);
    dispatch({ kind: "reset" });
    setPhase("start");
  }

  const expired = plan ? Date.parse(plan.expiresAt) <= now : false;
  const current = PHASES.findIndex((p) => p.id === phase);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-bold leading-10">{t("setupFlow.page.title")}</h1>
        <p className="text-sm leading-7 text-muted">{t("setupFlow.page.intro")}</p>
      </header>
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t("setupFlow.page.title")}>
        {PHASES.map((p, i) => (
          <li key={p.id} aria-current={i === current ? "step" : undefined} className={cn("flex items-center gap-1.5", i === current ? "font-semibold text-accent" : i < current ? "text-foreground" : "text-muted")}>
            <span className="inline-flex size-6 items-center justify-center rounded-full border border-current text-xs">{faNumber(i + 1)}</span>
            {t(`setupFlow.page.${p.label}`)}
          </li>
        ))}
      </ol>

      {phase === "start" ? (
        <>
          {startError ? <ErrorBanner message={startError} /> : null}
          <StartStep busy={busy} onFile={onFile} onAnswers={onAnswers} />
        </>
      ) : null}

      {phase === "analysis" && result && draft ? (
        <AnalysisStep
          result={result}
          draft={draft}
          showProblems={showProblems}
          busy={busy}
          error={planError}
          onChange={(p) => setDraft({ ...draft, ...p })}
          onBack={startOver}
          onContinue={toReview}
          onRetryCatalog={retryCatalog}
        />
      ) : null}

      {phase === "review" && plan && draft ? (
        <ReviewStep
          plan={plan}
          draft={draft}
          expired={expired}
          costIncomplete={hasUnpricedBundle(result?.catalog?.appPlans, draft.planId, draft.bundlePlanId)}
          onBack={() => setPhase("analysis")}
          onConfirm={startRun}
        />
      ) : null}

      {phase === "run" && plan ? <RunPanel plan={plan.plan} run={run} onRestart={startOver} /> : null}
    </div>
  );
}
