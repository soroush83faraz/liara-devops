import { CircleAlert, CircleCheck, CircleDashed, CircleX, Hammer } from "lucide-react";
import { Badge } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { releaseTone, type ReleaseTone } from "@/lib/service/app-read/release-utils";

const ICON = { ok: CircleCheck, danger: CircleX, warn: CircleAlert, info: Hammer, neutral: CircleDashed } as const;
const TONE = { ok: "ok", danger: "danger", warn: "warn", info: "accent", neutral: "neutral" } as const;

/** Maps a state tone onto a Badge tone. */
export const badgeToneFor = (tone: ReleaseTone) => TONE[tone];

const labels = fa.appOps.releases.state as Record<string, string>;

/** Release state: icon + text + tone (never colour alone). Unknown states show the raw value, LTR. */
export function ReleaseStateBadge({ state }: { state: string }) {
  const tone = releaseTone(state);
  const Icon = ICON[tone];
  const label = labels[state.toUpperCase()];
  return (
    <Badge tone={TONE[tone]}>
      <Icon aria-hidden className={tone === "info" ? "size-3.5 animate-pulse" : "size-3.5"} />
      {label ?? <bdi dir="ltr" className="font-mono">{state}</bdi>}
    </Badge>
  );
}
