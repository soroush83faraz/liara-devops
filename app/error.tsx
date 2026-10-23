"use client";

import Link from "next/link";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { faErrors } from "@/lib/deploy/fa-errors";

interface ErrorPageProps {
  error: unknown;
  retry?: () => void;
  reset?: () => void;
}

/** Only the opaque digest is shown (matches a server log line); messages and stacks never reach the page. */
function digestOf(error: unknown): string | undefined {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^[\w-]{1,32}$/.test(digest) ? digest : undefined;
}

export default function ErrorPage({ error, retry, reset }: ErrorPageProps) {
  useEffect(() => {
    // Keep a breadcrumb in the browser console without rendering anything sensitive.
    console.error("[ui] route error", digestOf(error) ?? "no-digest");
  }, [error]);
  const digest = digestOf(error);
  return (
    <main id="main-content" className="mx-auto flex min-h-dvh w-full max-w-lg items-center justify-center px-4">
      <div role="alert" className="flex flex-col items-center">
        <EmptyState
          icon={<TriangleAlert />}
          title={faErrors.error.title}
          description={faErrors.error.description}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button onClick={() => (retry ?? reset)?.()}>{faErrors.error.retry}</Button>
              <Link href="/" className={buttonVariants({ variant: "secondary" })}>
                {faErrors.error.home}
              </Link>
            </div>
          }
        />
        {digest ? (
          <p className="text-xs text-muted">
            {faErrors.error.reference}: <bdi dir="ltr" className="font-mono">{digest}</bdi>
          </p>
        ) : null}
      </div>
    </main>
  );
}
