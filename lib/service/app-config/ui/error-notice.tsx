"use client";

import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountdown } from "../client";
import { countdownMessage, type DescribedError } from "../errors";

/** Inline error (icon + text). A 429 shows a live countdown instead of a static number. */
export function ErrorNotice({ error, className }: { error: DescribedError; className?: string }) {
  const countdown = error.kind === "rate_limited" && !!error.retryAfterSec;
  return (
    <p
      role="alert"
      className={cn("flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm leading-7 text-danger-ink", className)}
    >
      <CircleAlert aria-hidden className="mt-1 size-4 shrink-0" />
      {countdown ? <Countdown key={error.retryAfterSec} seconds={error.retryAfterSec!} /> : <span>{error.message}</span>}
    </p>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const left = useCountdown(seconds);
  return <span>{countdownMessage(left)}</span>;
}
