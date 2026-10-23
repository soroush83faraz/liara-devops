"use client";

import { CircleHelp, Shield, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { EvidenceLevel, LevelReason } from "@/lib/contracts";
import { fill } from "@/lib/copilot/text";
import { fa } from "@/lib/i18n/fa";
import { cn } from "@/lib/utils";

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

const BARS: Record<EvidenceLevel, number> = { strong: 3, medium: 2, weak: 1, insufficient: 0 };

/** Three-bar signal gauge: how much the evidence carries, readable at a glance (the text says it too). */
function SignalBars({ level }: { level: EvidenceLevel }) {
  const lit = BARS[level];
  return (
    <span aria-hidden className="inline-flex h-3 items-end gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-[1px] bg-current transition-opacity", i < lit ? "opacity-100" : "opacity-25")}
          style={{ height: `${5 + i * 3.5}px` }}
        />
      ))}
    </span>
  );
}

/** Evidence level chip: icon + text («شواهد قوی» ...), with the rule reason in a tooltip (also printed under «چرا؟»). */
export function EvidenceLevelChip({ level, reason }: { level: EvidenceLevel; reason?: LevelReason }) {
  const meta = META[level];
  const Icon = meta.icon;
  // `w-fit`: inside a column (finding card, incident root cause) the chip hugs its text at the reading start
  // instead of stretching to the column and floating in the middle.
  const chip = (
    <Badge tone={meta.tone} className="w-fit gap-1.5">
      {level === "insufficient" ? <Icon aria-hidden className="size-3.5" /> : <SignalBars level={level} />}
      {l.levelChip[level]}
    </Badge>
  );
  if (!reason) return chip;
  return (
    <Tooltip content={levelReasonLine(reason)}>
      <button type="button" className="w-fit rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        {chip}
      </button>
    </Tooltip>
  );
}
