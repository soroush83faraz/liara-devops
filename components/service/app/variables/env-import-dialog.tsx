"use client";

import { Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Field, Textarea } from "@/components/ui";
import { runOp } from "@/lib/client/ops";
import { t } from "@/lib/i18n/t";
import { buildEnvDiff, buildSetEnvRequest, MAX_ENV_CHANGES, parseDotenv, type ParseIssueCode } from "@/lib/service/app-config/env-parse";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";

const ISSUE_KEY = {
  invalid_key: "appConfig.vars.import.issue.invalidKey",
  no_equals: "appConfig.vars.import.issue.noEquals",
  multiline: "appConfig.vars.import.issue.multiline",
  bad_quote: "appConfig.vars.import.issue.badQuote",
  value_too_long: "appConfig.vars.import.issue.tooLong",
  nul: "appConfig.vars.import.issue.nul",
  duplicate: "appConfig.vars.import.issue.duplicate",
} as const satisfies Record<ParseIssueCode, string>;

/**
 * Paste `.env` text -> parsed in the browser -> key-level diff -> one `set_env` operation.
 * Values are shown nowhere (neither in the preview nor in issues) and the pasted text is dropped on close.
 */
export function EnvImportDialog({
  appName,
  existingKeys,
  onClose,
}: {
  appName: string;
  existingKeys: readonly string[];
  onClose: () => void;
}) {
  const done = useAfterMutation(appName);
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseDotenv(text), [text]);
  const diff = useMemo(() => buildEnvDiff(existingKeys, parsed.entries), [existingKeys, parsed.entries]);
  const blocking = parsed.issues.filter((i) => i.severity === "error");
  const warnings = parsed.issues.filter((i) => i.severity === "warning");
  const canApply = diff.items.length > 0 && !diff.overLimit;

  return (
    <OpDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t("appConfig.vars.import.title")}
      operation={t("appConfig.vars.import.operation", { count: diff.items.length })}
      target={appName}
      effect={t("appConfig.vars.effect")}
      risk={t("appConfig.vars.import.risk")}
      reversible="partly"
      confirmLabel={t("appConfig.vars.import.apply", { count: diff.items.length })}
      confirmDisabled={!canApply}
      dirty={text.trim().length > 0}
      onConfirm={async () => {
        if (!canApply) throw new Error("nothing to apply");
        const req = buildSetEnvRequest(appName, parsed.entries);
        await runOp({ params: req.params, userValues: req.userValues });
        done(t("appConfig.vars.import.doneToast", { count: diff.items.length }));
      }}
    >
      <div className="flex flex-col gap-3">
        <Field label={t("appConfig.vars.import.pasteLabel")} hint={t("appConfig.vars.import.hint")}>
          {(p) => (
            <Textarea
              {...p}
              dir="ltr"
              rows={6}
              className="text-start font-mono text-[13px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"KEY=value\nexport OTHER_KEY=\"value\""}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
            />
          )}
        </Field>

        {text.trim() && diff.items.length === 0 && blocking.length === 0 ? (
          <p role="status" className="text-sm text-muted">
            {t("appConfig.vars.import.nothing")}
          </p>
        ) : null}

        {diff.items.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {t("appConfig.vars.import.diffTitle", { added: diff.added, overwritten: diff.overwritten })}
            </p>
            <ul className="max-h-48 divide-y divide-border overflow-auto rounded-lg border border-border">
              {diff.items.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                  <bdi dir="ltr" className="break-all font-mono text-sm">
                    {i.key}
                  </bdi>
                  <span className="flex items-center gap-1.5">
                    {i.publicPrefix ? (
                      <Badge tone="warn">
                        <TriangleAlert aria-hidden className="size-3" />
                        {t("appConfig.vars.publicBadge")}
                      </Badge>
                    ) : null}
                    {i.kind === "add" ? (
                      <Badge tone="ok">
                        <Plus aria-hidden className="size-3" />
                        {t("appConfig.vars.import.kindAdd")}
                      </Badge>
                    ) : (
                      <Badge tone="warn">
                        <RefreshCw aria-hidden className="size-3" />
                        {t("appConfig.vars.import.kindOverwrite")}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-6 text-muted">{t("appConfig.vars.import.untouched")}</p>
          </div>
        ) : null}

        {diff.overLimit ? (
          <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm leading-7 text-danger-ink">
            {t("appConfig.vars.import.overLimit", { max: MAX_ENV_CHANGES })}
          </p>
        ) : null}

        {blocking.length > 0 || warnings.length > 0 ? (
          <div role="status" className="rounded-lg bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
            <p className="font-medium">{t("appConfig.vars.import.issuesTitle", { count: blocking.length })}</p>
            <ul className="mt-1 list-disc ps-5">
              {[...blocking, ...warnings].slice(0, 12).map((i, idx) => (
                <li key={idx}>
                  {t("appConfig.vars.import.issueLine", { line: i.line })} {t(ISSUE_KEY[i.code])}
                  {i.key ? (
                    <>
                      {" "}
                      <bdi dir="ltr" className="font-mono text-xs">
                        {i.key}
                      </bdi>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </OpDialog>
  );
}
