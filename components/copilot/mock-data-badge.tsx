"use client";

import { FlaskConical } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { isMockEnabled } from "@/lib/copilot/http";
import { devMock } from "@/lib/i18n/dev-mock";

const noSubscription = () => () => undefined;

/**
 * Persistent «داده‌ی نمونه (حالت آزمایشی)» label for anything the dev-only mock produced (incidents, cards).
 * Renders nothing unless the mock is active, and nothing at all in production builds (NODE_ENV is a compile-time
 * constant there, so a mock-only label never reaches real users).
 */
export function MockDataBadge({ className }: { className?: string }) {
  // Client-only flags (URL / session storage) are read after hydration; the server snapshot is always "off".
  const on = useSyncExternalStore(noSubscription, () => process.env.NODE_ENV !== "production" && isMockEnabled(), () => false);
  if (process.env.NODE_ENV === "production" || !on) return null;
  return (
    <Badge tone="warn" className={className} data-mock-data="">
      <FlaskConical aria-hidden className="size-3.5" />
      {devMock.dataBadge}
    </Badge>
  );
}
