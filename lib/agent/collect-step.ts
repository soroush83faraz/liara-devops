// PASS 1 wrapper: runs the deterministic collectors and reports each source as a step part.
import { collectAppEvidence, collectDbEvidence } from "@/lib/evidence/collect";
import { APP_SOURCES, DB_SOURCES, NOT_APPLICABLE, type EvidenceBundle, type SourceStatus } from "@/lib/evidence/types";
import type { probeApp } from "@/lib/canvas/probe";
import type { LiaraClient } from "@/lib/liara";
import type { StepStatus } from "@/lib/contracts/stream";
import type { Emitter } from "./emit";
import { SOURCE_LABEL_FA, STEP_LABEL_FA } from "./fa-messages";
import type { ResolvedTarget } from "./target";

export const sourceStepId = (source: string) => `src-${source.replace(/_/g, "-")}`;

function stepStatus(s: SourceStatus): StepStatus {
  if (s.status === "ok") return "done";
  if (s.status === "unavailable") return s.error === NOT_APPLICABLE || s.error === "plan_id_unknown" || s.error === "plan_not_found" ? "skipped" : "failed";
  return "failed";
}

export async function collectWithSteps(
  liara: LiaraClient,
  target: ResolvedTarget,
  emit: Emitter,
  opts: { now: () => number; knownSecrets: readonly string[]; probe?: typeof probeApp; signal?: AbortSignal },
): Promise<EvidenceBundle> {
  const sources = target.kind === "app" ? APP_SOURCES : DB_SOURCES;
  emit.step("collect", STEP_LABEL_FA.collect, "running");
  for (const s of sources) emit.step(sourceStepId(s), SOURCE_LABEL_FA[s], "running");
  const bundle =
    target.kind === "app"
      ? await collectAppEvidence({ liara, name: target.name, now: opts.now, knownSecrets: opts.knownSecrets, ...(opts.probe ? { probe: opts.probe } : {}), ...(opts.signal ? { signal: opts.signal } : {}) })
      : await collectDbEvidence({ liara, hostnameOrId: target.dbRef ?? target.name, now: opts.now, knownSecrets: opts.knownSecrets });
  const seen = new Set<string>();
  for (const s of bundle.sources) {
    seen.add(s.source);
    emit.step(sourceStepId(s.source), SOURCE_LABEL_FA[s.source], stepStatus(s), s.status === "ok" ? undefined : s.error);
  }
  for (const s of sources) if (!seen.has(s)) emit.step(sourceStepId(s), SOURCE_LABEL_FA[s], "skipped");
  const allFailed = allSourcesFailed(bundle);
  emit.step("collect", STEP_LABEL_FA.collect, allFailed ? "failed" : "done");
  for (const o of bundle.observations) emit.observation(o);
  return bundle;
}

export const anySourceFailed = (b: EvidenceBundle) => b.sources.some((s) => s.status === "failed");
/** Context reads that say nothing about the target's health (plan limits, the account's database list). */
const CONTEXT_ONLY_SOURCES: ReadonlySet<string> = new Set(["plan", "databases"]);

/**
 * No health-relevant source answered: no evidence at all about the target (the answer must say so, never
 * "no sign of an error"). Context-only reads (plan, database list) that succeeded do not count as evidence.
 */
export const allSourcesFailed = (b: EvidenceBundle) =>
  b.sources.length > 0 && !b.sources.some((s) => s.status === "ok" && !CONTEXT_ONLY_SOURCES.has(s.source));
