// One place for "try primary, retry once on fallback, then degrade" so every stage behaves the same.
import { classifyLlmError, degradeMove, logFailure, type AgentModels, type DegradeMove, type LlmFailure, type LlmStage, type ModelHandle } from "./provider";

export type LlmOutcome<T> = { ok: true; value: T; modelId: string } | { ok: false; failure: LlmFailure; move: DegradeMove };

export async function callWithFallback<T>(
  models: AgentModels,
  stage: LlmStage,
  run: (h: ModelHandle) => Promise<T>,
  signal?: AbortSignal,
): Promise<LlmOutcome<T>> {
  const handles = [models.primary, ...(models.fallback ? [models.fallback] : [])];
  let last: { failure: LlmFailure; move: DegradeMove } = { failure: "unknown", move: "rule_only" };
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    try {
      return { ok: true, value: await run(h), modelId: h.id };
    } catch (e) {
      const failure: LlmFailure = signal?.aborted ? "aborted" : classifyLlmError(e);
      logFailure(stage, h.id, failure);
      const move = degradeMove(failure, stage, i + 1 < handles.length);
      last = { failure, move };
      if (move !== "retry_fallback") return { ok: false, ...last };
    }
  }
  return { ok: false, failure: last.failure, move: last.move === "retry_fallback" ? "rule_only" : last.move };
}
