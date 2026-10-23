"use client";

import { ChevronDown, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { emptyAwareDir } from "@/components/ui/dir";
import { Field, Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { Ltr } from "@/components/code";
import { useResetAccountState } from "@/lib/client/account-reset";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

interface ApiError {
  error?: { code?: string; message?: string };
}

export function ConnectForm() {
  const router = useRouter();
  const resetAccountState = useResetAccountState();
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setFieldError(null);
    if (!token.trim()) {
      setFieldError(t("connect.errors.tokenRequired"));
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), teamId: teamId.trim() || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        setError(body.error?.message ?? t("errors.generic"));
        setPending(false);
        return;
      }
      // The key now lives in the encrypted cookie only; drop it from memory before navigating.
      setToken("");
      resetAccountState();
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("errors.network"));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate aria-busy={pending}>
      {error ? <ErrorBanner message={error} /> : null}

      <Field label={t("connect.tokenLabel")} hint={t("connect.tokenHint")} error={fieldError}>
        {(p) => (
          <div className="relative">
            <Input
              {...p}
              dir={emptyAwareDir(token, "ltr")}
              name="token"
              type={reveal ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("connect.tokenPlaceholder")}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={pending}
              invalid={Boolean(fieldError)}
              // The eye button sits on the physical left in this RTL page: pad the left side whichever way the field runs.
              className={cn("text-start", token ? "ps-12 font-mono" : "pe-12 font-sans")}
            />
            <IconButton
              label={reveal ? t("connect.hideToken") : t("connect.showToken")}
              icon={reveal ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
              onClick={() => setReveal((v) => !v)}
              aria-pressed={reveal}
              size="sm"
              className="absolute end-0.5 top-1/2 -translate-y-1/2"
            />
          </div>
        )}
      </Field>

      <Field label={t("connect.teamLabel")} hint={t("connect.teamHint")} optional>
        {(p) => (
          <Input
            {...p}
            dir={emptyAwareDir(teamId, "ltr")}
            name="teamId"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder={t("connect.teamPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            className={cn("text-start", teamId ? "font-mono" : "font-sans")}
          />
        )}
      </Field>

      <Button type="submit" size="lg" fullWidth loading={pending} loadingText={t("connect.submitting")}>
        {t("connect.submit")}
      </Button>

      <details className="group rounded-xl border border-border bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 text-[15px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          {t("connect.help.toggle")}
          <ChevronDown aria-hidden className="size-4 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <ol className="list-decimal space-y-1 border-t border-border px-4 py-3 ps-9 text-sm leading-8 marker:text-muted">
          <li>
            {t("connect.help.step1Before")} <Ltr>console.liara.ir</Ltr> {t("connect.help.step1After")}
          </li>
          <li>{t("connect.help.step2")}</li>
          <li>{t("connect.help.step3")}</li>
          <li>{t("connect.help.step4")}</li>
        </ol>
        <p className="border-t border-border px-4 py-2 text-xs leading-7 text-muted">{t("connect.help.tip")}</p>
      </details>

      <p className="flex items-start gap-2 rounded-xl bg-accent-soft p-3 text-sm leading-7 text-accent-ink">
        <ShieldCheck aria-hidden className="mt-1 size-4 shrink-0" />
        {t("connect.safety")}
      </p>
    </form>
  );
}
