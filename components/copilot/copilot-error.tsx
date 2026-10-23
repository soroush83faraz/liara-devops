"use client";

import Link from "next/link";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { ErrorData } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import type { ThreadError } from "@/lib/copilot/thread";
import { useCountdown } from "./use-now";

const e = fa.copilotUi.errors;

const MESSAGES: Record<string, string> = {
  unauthorized: e.unauthorized,
  forbidden: e.forbidden,
  notFound: e.notFound,
  conflict: e.conflict,
  timeout: e.timeout,
  server: e.server,
  network: e.network,
  stream: e.stream,
  invalid: e.invalid,
  generic: e.generic,
};

/** Transport / HTTP failure of the agent request, mapped to the plan's error states. Retry is offered when safe. */
export function CopilotErrorBanner({ error, onRetry }: { error: ThreadError; onRetry?: () => void }) {
  const left = useCountdown(error.code === "rateLimited" ? (error.retryAfterSec ?? 30) : undefined);
  const message =
    error.code === "rateLimited" ? fill(e.rateLimited, { seconds: left }) : (MESSAGES[error.code] ?? e.generic);
  const canRetry = onRetry && error.code !== "unauthorized" && error.code !== "forbidden" && (error.code !== "rateLimited" || left === 0);
  return (
    <div className="flex flex-col gap-2">
      <ErrorBanner
        title={e.title}
        message={message}
        detail={error.status ? `HTTP ${error.status}` : undefined}
        onRetry={canRetry ? onRetry : undefined}
        tone={error.code === "rateLimited" || error.code === "conflict" ? "warn" : "danger"}
      />
      {error.code === "unauthorized" ? (
        <Link href="/connect" className="inline-flex min-h-11 items-center self-start text-sm font-medium text-accent underline">
          {e.reconnect}
        </Link>
      ) : null}
    </div>
  );
}

/** A `data-error` part written by the server. Persian text is shown as plain text; the code is shown LTR. */
export function ErrorCard({ data, detail, onRetry }: { data: ErrorData; detail?: string; onRetry?: () => void }) {
  const left = useCountdown(data.retryAfterSec);
  const message = data.code === "stream.error" ? e.stream : stripUnsafeChars(data.messageFa);
  const retryable = onRetry && (data.retryAfterSec === undefined || left === 0);
  return (
    <ErrorBanner
      title={e.title}
      message={data.retryAfterSec ? `${message} ${fill(e.rateLimited, { seconds: left })}` : message}
      detail={detail ?? `${e.codeLabel}: ${data.code}`}
      onRetry={retryable ? onRetry : undefined}
    />
  );
}
