// injection-suspect: log/build/event lines that address the assistant. Kept as flagged observations so
// the UI can show them; levels and hypothesis rules never use flagged observations.
import { mergeOccurrence, occurrenceParams, type Occurrence } from "../lines";
import { markSuspicious } from "../injection";
import { draft, SIG } from "../observe";
import type { DraftObservation, ExtractContext, LogGroup, ObservationSource } from "../types";

export function extractInjectionSuspect(ctx: ExtractContext): DraftObservation[] {
  const found = new Map<string, { source: ObservationSource; reasons: string[]; occ: Occurrence }>();
  const scan = (groups: readonly LogGroup[], source: ObservationSource) => {
    for (const g of groups) {
      const r = markSuspicious(g.message);
      if (!r.suspicious) continue;
      const prev = found.get(g.pattern);
      found.set(g.pattern, { source: prev?.source ?? source, reasons: prev?.reasons ?? r.reasons, occ: mergeOccurrence(prev?.occ, g) });
    }
  };
  scan(ctx.logGroups, "liara:logs");
  scan(ctx.buildGroups, "liara:build-logs");
  scan(ctx.eventGroups, "liara:events");
  return [...found.values()].map(({ source, reasons, occ }) => ({
    ...draft("log_error", source, "evidence.injection.suspect", "warn", occ.sample,
      { reasons: reasons.join(","), ...occurrenceParams(occ), [SIG]: false }, occ.firstTs),
    flagged: true,
  }));
}
