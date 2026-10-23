// Extractor registry. Order is part of the contract: it fixes observation order (and ids) and which
// observations survive the per-kind caps.
import { markSuspicious } from "../injection";
import type { DraftObservation, ExtractContext, Extractor } from "../types";
import { extractAppletState } from "./applet-state";
import { extractBuildError } from "./build-error";
import { extractConfig } from "./config";
import { extractConnection } from "./connection";
import { extractCrash } from "./crash";
import { extractDbState } from "./db-state";
import { extractEvents, extractLifecycle } from "./events";
import { extractHttpStatus } from "./http-status";
import { extractInjectionSuspect } from "./injection-suspect";
import { extractMetric } from "./metric";
import { extractMissingEnv } from "./missing-env";
import { extractOom } from "./oom";
import { extractPortMismatch } from "./port-mismatch";
import { extractProbe } from "./probe";
import { extractReleaseState } from "./release-state";

export const EXTRACTORS: ReadonlyArray<readonly [string, Extractor]> = [
  ["release-state", extractReleaseState],
  ["build-error", extractBuildError],
  ["missing-env", extractMissingEnv],
  ["config", extractConfig],
  ["connection", extractConnection],
  ["port-mismatch", extractPortMismatch],
  ["crash", extractCrash],
  ["oom", extractOom],
  ["db-state", extractDbState],
  ["metric", extractMetric],
  ["http-status", extractHttpStatus],
  ["probe", extractProbe],
  ["applet-state", extractAppletState],
  ["events", extractEvents],
  ["injection-suspect", extractInjectionSuspect],
];

/** Extractors that read runtime log lines (run alone on the lines of previous releases). */
export const LOG_EXTRACTORS: ReadonlySet<string> = new Set(["build-error", "missing-env", "config", "connection", "port-mismatch", "crash", "oom", "http-status", "injection-suspect"]);

/** Runs every extractor (or the named subset) in order; any observation whose excerpt looks like an injection is flagged. */
export function runExtractors(ctx: ExtractContext, only?: ReadonlySet<string>): DraftObservation[] {
  const out: DraftObservation[] = [];
  for (const [name, fn] of EXTRACTORS) {
    if (only && !only.has(name)) continue;
    for (const d of fn(ctx)) {
      out.push(d.flagged || !markSuspicious(d.text).suspicious ? d : { ...d, flagged: true });
    }
  }
  return out;
}

export {
  extractAppletState,
  extractBuildError,
  extractConfig,
  extractConnection,
  extractCrash,
  extractDbState,
  extractEvents,
  extractLifecycle,
  extractHttpStatus,
  extractInjectionSuspect,
  extractMetric,
  extractMissingEnv,
  extractOom,
  extractPortMismatch,
  extractProbe,
  extractReleaseState,
};
