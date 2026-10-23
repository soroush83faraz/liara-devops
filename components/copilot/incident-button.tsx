import { FileText } from "lucide-react";
import Link from "next/link";
import { fa } from "@/lib/i18n/fa";

/** Link to the shareable incident report (`/incidents/[id]`). */
export function IncidentButton({ incidentId }: { incidentId: string }) {
  return (
    <Link
      href={`/incidents/${encodeURIComponent(incidentId)}`}
      className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg border border-border-strong/50 bg-surface px-4 text-sm font-medium hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <FileText aria-hidden className="size-4" />
      {fa.copilotUi.verification.report}
    </Link>
  );
}
