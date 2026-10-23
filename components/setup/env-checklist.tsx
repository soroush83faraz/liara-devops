"use client";

import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { emptyAwareDir, isPersian } from "@/components/ui/dir";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { EnvRow } from "@/lib/setup/draft";
import { ENV_NAME_RE } from "@/lib/setup/env-names";
import { envHelpText } from "@/lib/setup/text";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

/**
 * Env var checklist. Names come from the project; values are typed here and live ONLY in this component tree's
 * React state (the wizard holds them). They are sent once, in the execute request body.
 */
export function EnvChecklist({
  rows,
  wiredNames,
  onChange,
  showMissing,
}: {
  rows: EnvRow[];
  wiredNames: ReadonlySet<string>;
  onChange: (rows: EnvRow[]) => void;
  showMissing: boolean;
}) {
  const [extra, setExtra] = useState("");
  const extraValid = ENV_NAME_RE.test(extra) && !rows.some((r) => r.name === extra);
  const patch = (i: number, p: Partial<EnvRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-7 text-muted">{t("setupFlow.env.help")}</p>
      {rows.length === 0 ? <p className="text-sm text-muted">{t("setupFlow.env.empty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const wired = wiredNames.has(r.name);
          const active = r.include && !wired;
          const needsValue = active && r.valueSource === "user";
          const help = envHelpText(r.helpKey);
          const ph = r.placeholder ?? t("setupFlow.env.valuePlaceholder");
          return (
            <li key={r.name} className={cn("flex flex-col gap-2 rounded-xl border border-border p-3", !active && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--accent)]"
                    checked={active}
                    disabled={wired}
                    onChange={(e) => patch(i, { include: e.target.checked })}
                    aria-label={`${t("setupFlow.env.include")}: ${r.name}`}
                  />
                  <bdi dir="ltr" className="font-mono text-sm font-semibold">{r.name}</bdi>
                </label>
                {r.secret ? (
                  <Badge tone="warn">
                    <KeyRound aria-hidden className="size-3" />
                    {t("setupFlow.env.secret")}
                  </Badge>
                ) : null}
                {wired ? <Badge tone="accent">{t("setupFlow.env.wired")}</Badge> : null}
                {r.extra ? (
                  <IconButton label={t("setupFlow.env.remove")} icon={<Trash2 aria-hidden />} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
                ) : null}
              </div>
              {active ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <select
                    aria-label={t("setupFlow.env.source")}
                    className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-sm md:min-h-10"
                    value={r.valueSource}
                    onChange={(e) => patch(i, { valueSource: e.target.value === "generated" ? "generated" : "user" })}
                  >
                    <option value="user">{t("setupFlow.env.sourceUser")}</option>
                    <option value="generated">{t("setupFlow.env.sourceGenerated")}</option>
                  </select>
                  {r.valueSource === "user" ? (
                    <div className="min-w-0 flex-1">
                      <Input
                        dir={emptyAwareDir(r.value, "ltr", ph)}
                        className={r.value || !isPersian(ph) ? "text-start font-mono" : "text-start"}
                        type={r.secret ? "password" : "text"}
                        autoComplete="new-password"
                        spellCheck={false}
                        data-1p-ignore
                        aria-label={`${t("setupFlow.env.value")}: ${r.name}`}
                        placeholder={ph}
                        value={r.value}
                        invalid={showMissing && r.value === ""}
                        onChange={(e) => patch(i, { value: e.target.value })}
                      />
                      {showMissing && needsValue && r.value === "" ? <p role="alert" className="mt-1 text-xs text-danger">{t("setupFlow.env.missing")}</p> : null}
                    </div>
                  ) : (
                    <p className="flex-1 text-xs leading-6 text-muted">{t("setupFlow.env.generatedNote")}</p>
                  )}
                </div>
              ) : null}
              {help ? <p className="text-xs leading-6 text-muted">{help}</p> : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="env-extra" className="text-sm font-medium">{t("setupFlow.env.extraName")}</label>
          <Input id="env-extra" dir="ltr" className="text-start font-mono" value={extra} onChange={(e) => setExtra(e.target.value.toUpperCase())} invalid={extra !== "" && !extraValid} />
        </div>
        <Button
          variant="secondary"
          disabled={!extraValid}
          onClick={() => {
            onChange([...rows, { name: extra, include: true, valueSource: "user", value: "", secret: false, wired: false, extra: true }]);
            setExtra("");
          }}
        >
          <Plus aria-hidden className="size-4" />
          {t("setupFlow.env.addExtra")}
        </Button>
      </div>
    </div>
  );
}
