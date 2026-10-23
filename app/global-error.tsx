"use client";

// Replaces the root layout when it fails, so it brings its own document, fonts and styles.
import "vazirmatn/Vazirmatn-Variable-font-face.css";
import "./globals.css";
import { faErrors } from "@/lib/deploy/fa-errors";

interface GlobalErrorProps {
  error: unknown;
  retry?: () => void;
  reset?: () => void;
}

export default function GlobalError({ retry, reset }: GlobalErrorProps) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      <body className="min-h-full">
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-xl font-bold leading-8">{faErrors.globalError.title}</h1>
          <p className="text-sm leading-7 text-muted">{faErrors.globalError.description}</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => (retry ?? reset)?.()}
              className="min-h-11 rounded-lg border border-transparent bg-accent px-4 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
            >
              {faErrors.globalError.retry}
            </button>
            {/* A full document load is intended here: the router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="inline-flex min-h-11 items-center rounded-lg border border-border-strong/50 bg-surface px-4 text-[15px] font-medium text-foreground hover:bg-surface-muted">
              {faErrors.notFound.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
