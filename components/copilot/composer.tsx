"use client";

import { Send, Square } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { emptyAwareDir } from "@/components/ui/dir";
import { fieldClass } from "@/components/ui/input";
import { fa } from "@/lib/i18n/fa";
import { shouldSubmitOnEnter } from "@/lib/copilot/keys";
import { cn } from "@/lib/utils";

const p = fa.copilotUi.panel;

/**
 * Message composer. Enter sends, Shift+Enter adds a line, and an Enter that only confirms an IME composition
 * (Persian/Arabic/mobile keyboards) never sends. Disabled while a run is streaming, with a stop button.
 */
export function Composer({
  streaming,
  onSend,
  onStop,
  scopeLabel,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  scopeLabel: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const wasStreaming = useRef(false);

  // Give focus back to the box when a run ends so the next question can be typed immediately.
  useEffect(() => {
    if (wasStreaming.current && !streaming) ref.current?.focus();
    wasStreaming.current = streaming;
  }, [streaming]);

  const canSend = text.trim().length > 0 && !streaming;

  function submit() {
    if (!canSend) return;
    onSend(text);
    setText("");
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label id={`${hintId}-label`} htmlFor={`${hintId}-input`} className="sr-only">
        {p.composerLabel}
      </label>
      <span id={`${hintId}-scope`} hidden>
        {scopeLabel}
      </span>
      <div className="flex items-end gap-2">
        <textarea
          id={`${hintId}-input`}
          ref={ref}
          dir={emptyAwareDir(text)}
          rows={2}
          value={text}
          disabled={streaming}
          placeholder={p.placeholder}
          aria-describedby={hintId}
          aria-labelledby={`${hintId}-label ${hintId}-scope`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (shouldSubmitOnEnter({ key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
              e.preventDefault();
              submit();
            }
          }}
          className={cn(fieldClass(false), "max-h-40 min-h-[3.25rem] flex-1 resize-none py-2 leading-7")}
        />
        {streaming ? (
          <Button type="button" variant="secondary" size="md" onClick={onStop} aria-label={p.stop} className="shrink-0">
            <Square aria-hidden className="size-4" />
            <span className="hidden sm:inline">{p.stop}</span>
          </Button>
        ) : (
          <Button type="submit" size="md" disabled={!canSend} aria-label={p.send} className="shrink-0">
            <Send aria-hidden className="size-4 rtl:-scale-x-100" />
            <span className="hidden sm:inline">{p.send}</span>
          </Button>
        )}
      </div>
      <p id={hintId} className="text-xs leading-6 text-muted">
        {p.hint}
      </p>
    </form>
  );
}
