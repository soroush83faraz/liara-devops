import { Info } from "lucide-react";
import { fa } from "@/lib/i18n/fa";

/** The model was unavailable: findings are rule-based (deterministic) and carry no model prose. */
export function LlmDegradeBanner() {
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn-soft p-3 text-warn-ink">
      <Info aria-hidden className="mt-1 size-4 shrink-0" />
      <div className="text-sm leading-7">
        <p className="font-semibold">{fa.copilotUi.degrade.title}</p>
        <p>{fa.copilotUi.degrade.body}</p>
      </div>
    </div>
  );
}
