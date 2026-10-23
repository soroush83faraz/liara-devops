"use client";

import { CircleHelp, Shield, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { EvidenceLevel, LevelReason } from "@/lib/contracts";
import { fill } from "@/lib/copilot/text";
import { fa } from "@/lib/i18n/fa";

const l = fa.copilotUi.finding;

const META: Record<EvidenceLevel, { tone: "ok" | "accent" | "warn" | "neutral"; icon: LucideIcon }> = {
  strong: { tone: "ok", icon: ShieldCheck },
  medium: { tone: "accent", icon: Shield },
  weak: { tone: "warn", icon: ShieldAlert },
  insufficient: { tone: "neutral", icon: CircleHelp },
};

export function ruleLabel(rule: string): string | undefined {
  return (l.ruleNames as Record<string, string>)[rule];
}

/** One-line tooltip text: the rule that produced the level and the three boolean inputs. */
export function levelReasonLine(reason: LevelReason): string {
  const yn = (b: boolean) => (b ? l.reasonYes : l.reasonNo);
  const rule = ruleLabel(reason.rule) ?? reason.rule;
  return fill(l.reasonLine, {
    rule,
    signature: yn(reason.signature),
    correlation: yn(reason.correlation),
    contradicted: yn(reason.contradicted),
  });
}

/** Evidence level chip: icon + text («شواهد قوی» ...), with the rule reason in a tooltip (also printed under «چرا؟»). */
export function EvidenceLevelChip({ level, reason }: { level: EvidenceLevel; reason?: LevelReason }) {
  const meta = META[level];
  const Icon = meta.icon;
  const chip = (
    <Badge tone={meta.tone} className="gap-1.5">
      <Icon aria-hidden className="size-3.5" />
      {l.levelChip[level]}
    </Badge>
  );
  if (!reason) return chip;
  return (
    <Tooltip content={levelReasonLine(reason)}>
      <button type="button" className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        {chip}
      </button>
    </Tooltip>
  );
}
