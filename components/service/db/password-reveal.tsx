"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, CopyButton } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { dbPath, postJson } from "@/lib/service/db/client";
import { errorMessage } from "./shared";

/** The password is hidden again after this many seconds. */
export const REVEAL_SECONDS = 15;

/**
 * Explicit, audited password reveal. The secret lives ONLY in this component's state (never in the query cache,
 * storage or the URL), is cleared after 15 s, when the tab is hidden and on unmount.
 * `onSecret` lets the parent build a copy-only connection string; it is called with `null` when hidden.
 */
export function PasswordReveal({ host, onSecret }: { host: string; onSecret?: (secret: string | null) => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const onSecretRef = useRef(onSecret);
  useEffect(() => {
    onSecretRef.current = onSecret;
  });

  const hide = useCallback(() => {
    setSecret(null);
    setLeft(0);
    onSecretRef.current?.(null);
  }, []);

  useEffect(() => {
    if (secret === null) return;
    const endsAt = Date.now() + REVEAL_SECONDS * 1000;
    const timer = setInterval(() => {
      const remaining = Math.ceil((endsAt - Date.now()) / 1000);
      if (remaining <= 0) hide();
      else setLeft(remaining);
    }, 1000);
    const onVisibility = () => {
      if (document.hidden) hide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [secret, hide]);

  useEffect(
    () => () => {
      abort.current?.abort();
      onSecretRef.current?.(null);
    },
    [],
  );

  async function reveal() {
    if (pending) return;
    setPending(true);
    setError(null);
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    try {
      const res = await postJson<{ secret?: string }>(dbPath(host, "credentials/reveal"), {}, ctl.signal);
      if (typeof res.secret !== "string" || !res.secret) throw new Error("empty");
      setSecret(res.secret);
      setLeft(REVEAL_SECONDS);
      onSecretRef.current?.(res.secret);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted">
          <KeyRound aria-hidden className="size-4" />
          {t("dbPanel.connection.password")}
        </span>
        <bdi
          dir="ltr"
          aria-label={secret === null ? t("dbPanel.connection.passwordHidden") : undefined}
          className="min-w-0 max-w-full break-all rounded-lg bg-code-bg px-3 py-1.5 font-mono text-[13px]"
        >
          {secret === null ? "••••••••••••" : secret}
        </bdi>
        {secret === null ? (
          <Button variant="secondary" size="sm" onClick={reveal} loading={pending} loadingText={t("dbPanel.connection.revealing")}>
            <Eye aria-hidden className="size-4" />
            {t("dbPanel.connection.reveal")}
          </Button>
        ) : (
          <>
            <CopyButton value={secret} label={t("dbPanel.connection.copyPassword")} size="sm" />
            <Button variant="ghost" size="sm" onClick={hide}>
              <EyeOff aria-hidden className="size-4" />
              {t("dbPanel.connection.hide")}
            </Button>
          </>
        )}
      </div>
      {secret !== null ? (
        <p role="status" aria-live="off" className="text-xs leading-6 text-warn-ink">
          {t("dbPanel.connection.autoHide", { seconds: Math.max(left, 0) })}
        </p>
      ) : (
        <p className="text-xs leading-6 text-muted">{t("dbPanel.connection.revealNote")}</p>
      )}
      {error ? (
        <p role="alert" className="text-sm leading-6 text-danger">
          {t("dbPanel.connection.revealFailed")}: {error}
        </p>
      ) : null}
    </div>
  );
}
