"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { PanelProps } from "@/lib/canvas/panel-registry";
import { fa } from "@/lib/i18n/fa";
import { fill } from "@/lib/copilot/text";
import { targetKey, useCopilotStore } from "@/lib/copilot/store";
import { emptyThread } from "@/lib/copilot/thread";
import type { AgentTarget } from "@/lib/copilot/stream-client";
import { Composer } from "./composer";
import { MockControls } from "./mock-controls";
import { SuggestedChips } from "./suggested-chips";
import { ThreadView } from "./thread-view";

const p = fa.copilotUi.panel;

/**
 * The «همیار» tab of the service panel: thread of typed cards + composer, scoped to the selected app or database.
 * Registered for kinds 'app' and 'db' (components/service/copilot/register.ts).
 */
export function CopilotPanel({ kind, name }: PanelProps) {
  const target: AgentTarget = useMemo(() => ({ kind, name }), [kind, name]);
  const key = targetKey(target);
  const thread = useCopilotStore((s) => s.threads[key]) ?? EMPTY;
  const send = useCopilotStore((s) => s.send);
  const retry = useCopilotStore((s) => s.retry);
  const stop = useCopilotStore((s) => s.stop);
  const reset = useCopilotStore((s) => s.reset);
  const pending = useCopilotStore((s) => s.pending[key]);
  const takeQuestion = useCopilotStore((s) => s.takeQuestion);

  const streaming = thread.status === "streaming";
  const endRef = useRef<HTMLDivElement>(null);

  // A question queued by the command bar runs as soon as this tab is on screen.
  useEffect(() => {
    if (pending === undefined) return;
    const q = takeQuestion(key);
    if (q) void send(target, q);
  }, [pending, key, target, send, takeQuestion]);

  // Keep the newest card in view while a run progresses (instant when the user prefers reduced motion).
  const cardCount = thread.turns.reduce((n, t) => n + t.cards.length, 0) + thread.turns.length;
  useEffect(() => {
    if (cardCount === 0) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [cardCount]);

  const onSend = useCallback((text: string) => void send(target, text), [send, target]);
  const onRetry = useCallback(() => void retry(target), [retry, target]);
  const onStop = useCallback(() => stop(key), [stop, key]);
  const onReevaluate = useCallback(() => void send(target, p.reevaluateQuestion), [send, target]);

  const empty = thread.turns.length === 0;

  return (
    <div className="flex min-h-[28rem] flex-col gap-4" data-copilot-panel={key}>
      <MockControls />

      <div className="flex-1">
        {empty ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3 px-2 pb-1 pt-6 text-center">
              <CopilotIllustration />
              <h3 className="text-[17px] font-bold">{p.emptyTitle}</h3>
              <p className="max-w-md text-sm leading-7 text-muted">{p.emptyBody}</p>
            </div>
            <SuggestedChips onPick={onSend} disabled={streaming} />
          </div>
        ) : (
          <ThreadView thread={thread} threadKey={key} onRetry={onRetry} onStop={onStop} onReevaluate={onReevaluate} />
        )}
        <div ref={endRef} aria-hidden />
      </div>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t border-border bg-surface px-4 pb-4 pt-3">
        {!empty && !streaming ? (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => reset(key)}>
              <RotateCcw aria-hidden className="size-4" />
              {p.reset}
            </Button>
          </div>
        ) : null}
        <Composer streaming={streaming} onSend={onSend} onStop={onStop} scopeLabel={fill(p.scope, { name })} />
      </div>
    </div>
  );
}

const EMPTY = emptyThread();

/**
 * Empty-thread illustration: a service node with a probe signal travelling to the assistant, which answers with
 * an evidence spark. Decorative; the travelling dash and ping stop under reduced motion (globals.css).
 */
function CopilotIllustration() {
  return (
    <svg aria-hidden viewBox="0 0 160 72" className="h-[72px] w-40 text-accent" fill="none">
      <path d="M40 36 C 64 14, 96 14, 120 36" stroke="var(--border-strong)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 4" />
      <path d="M40 36 C 64 14, 96 14, 120 36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" pathLength={100} className="hl-signal" />
      <rect x="10" y="20" width="32" height="32" rx="8" fill="var(--surface)" stroke="var(--border-strong)" strokeOpacity="0.6" />
      <rect x="18" y="29" width="16" height="4" rx="2" fill="var(--muted)" fillOpacity="0.55" />
      <rect x="18" y="37" width="10" height="4" rx="2" fill="var(--muted)" fillOpacity="0.35" />
      <circle cx="38" cy="22" r="4" fill="var(--danger)" />
      <circle cx="38" cy="22" r="4" fill="var(--danger)" className="hl-ping-svg" />
      <rect x="118" y="20" width="32" height="32" rx="16" fill="var(--accent-soft)" stroke="currentColor" strokeOpacity="0.45" />
      <path d="M134 28 l2.2 5.2 5.2 2.2 -5.2 2.2 -2.2 5.2 -2.2 -5.2 -5.2 -2.2 5.2 -2.2 z" fill="currentColor" />
    </svg>
  );
}
