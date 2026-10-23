import { Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fa } from "@/lib/i18n/fa";

const l = fa.copilotUi.proposal;

/** Tier chip: 1 = calm accent, 2 = amber (costs money / names a resource), 3 = danger (only a human may do it). */
export function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  const Icon = tier === 1 ? ShieldCheck : tier === 2 ? ShieldAlert : Lock;
  return (
    <Badge tone={tier === 1 ? "accent" : tier === 2 ? "warn" : "danger"} className="gap-1.5">
      <Icon aria-hidden className="size-3.5" />
      {tier === 1 ? l.tier.one : tier === 2 ? l.tier.two : l.tier.three}
    </Badge>
  );
}
