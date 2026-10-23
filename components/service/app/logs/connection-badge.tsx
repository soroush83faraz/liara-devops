import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle, Radio } from "lucide-react";
import { Badge } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import type { StreamState } from "@/lib/service/app-read/use-event-stream";

const c = fa.appOps.conn;

/** Visible connection state of a live stream (icon + text, announced politely). */
export function ConnectionBadge({ state, paused }: { state: StreamState; paused?: boolean }) {
  const view =
    state === "live"
      ? { tone: "ok" as const, icon: <Radio aria-hidden className="size-3.5" />, label: c.live }
      : state === "connecting"
        ? { tone: "neutral" as const, icon: <LoaderCircle aria-hidden className="size-3.5 animate-spin" />, label: c.connecting }
        : state === "reconnecting"
          ? { tone: "warn" as const, icon: <LoaderCircle aria-hidden className="size-3.5 animate-spin" />, label: c.reconnecting }
          : state === "failed"
            ? { tone: "danger" as const, icon: <CircleAlert aria-hidden className="size-3.5" />, label: c.failed }
            : { tone: "neutral" as const, icon: <CircleCheck aria-hidden className="size-3.5" />, label: c.ended };
  return (
    <span role="status" aria-live="polite" aria-label={c.statusLabel} className="inline-flex items-center gap-2">
      <Badge tone={view.tone}>
        {view.icon}
        {view.label}
      </Badge>
      {paused ? (
        <Badge>
          <CircleDashed aria-hidden className="size-3.5" />
          {fa.appOps.logs.pause}
        </Badge>
      ) : null}
    </span>
  );
}
