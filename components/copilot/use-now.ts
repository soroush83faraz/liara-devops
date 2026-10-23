"use client";

import { useEffect, useState } from "react";

/** Current time, refreshed every `intervalMs` while `enabled`. Client-only (components using it render after hydration). */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

/** Whole seconds left of a countdown that starts at mount with `seconds` (0 when none). */
export function useCountdown(seconds: number | undefined): number {
  const [deadline] = useState(() => Date.now() + (seconds ?? 0) * 1000);
  const now = useNow(1000, (seconds ?? 0) > 0);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
