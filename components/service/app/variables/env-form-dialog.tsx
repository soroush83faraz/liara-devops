"use client";

import { Download, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { runOp } from "@/lib/client/ops";
import { t } from "@/lib/i18n/t";
import { appPath, postJson } from "@/lib/service/app-config/client";
import type { RevealEnvDto } from "@/lib/service/app-config/dto";
import { buildSetEnvRequest, envKeyIssue, envValueIssue, isPublicEnvKey } from "@/lib/service/app-config/env-parse";
import { describeError, type DescribedError } from "@/lib/service/app-config/errors";
import { ErrorNotice } from "@/lib/service/app-config/ui/error-notice";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";

const KEY_ISSUE = {
  empty: "appConfig.vars.keyIssue.empty",
  bad_chars: "appConfig.vars.keyIssue.badChars",
  too_long: "appConfig.vars.keyIssue.tooLong",
  reserved: "appConfig.vars.keyIssue.reserved",
} as const;

/**
 * Add or edit one variable. The value lives only in this component's state: it is sent once through `runOp`
 * as `userValues` and dies with the component when the dialog closes (it is mounted only while open).
 */
export function EnvFormDialog({
  appName,
  mode,
  editKey,
  existingKeys,
  onClose,
}: {
  appName: string;
  mode: "add" | "edit";
  editKey?: string;
  existingKeys: readonly string[];
  onClose: () => void;
}) {
  const done = useAfterMutation(appName);
  const [key, setKey] = useState(editKey ?? "");
  const [value, setValue] = useState("");
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [loadError, setLoadError] = useState<DescribedError | null>(null);

  const keyIssue = mode === "add" ? envKeyIssue(key) : null;
  const valueIssue = envValueIssue(value);
  const overwrites = mode === "add" && existingKeys.includes(key);
  const valid = keyIssue === null && valueIssue === null && (mode === "edit" || key.length > 0);
  const dirty = value.length > 0 || (mode === "add" && key.length > 0);

  async function loadCurrent() {
    setLoadingCurrent(true);
    setLoadError(null);
    try {
      const res = await postJson<RevealEnvDto>(`${appPath(appName, "envs")}/reveal`, { key });
      setValue(res.value);
    } catch (e) {
      setLoadError(describeError(e));
    } finally {
      setLoadingCurrent(false);
    }
  }

  async function save() {
    if (!valid) throw new Error("invalid");
    const req = buildSetEnvRequest(appName, [{ key, value }]);
    await runOp({ params: req.params, userValues: req.userValues });
    done(t("appConfig.vars.savedToast", { key }));
  }

  return (
    <OpDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={mode === "add" ? t("appConfig.vars.addTitle") : t("appConfig.vars.editTitle")}
      operation={mode === "add" && !overwrites ? t("appConfig.vars.opAdd") : t("appConfig.vars.opSet")}
      target={appName}
      effect={t("appConfig.vars.effect")}
      risk={t("appConfig.vars.risk")}
      reversible="partly"
      confirmLabel={t("appConfig.vars.saveAndRestart")}
      confirmDisabled={!valid}
      dirty={dirty}
      onConfirm={save}
    >
      <div className="flex flex-col gap-3">
        <Field
          label={t("appConfig.vars.keyLabel")}
          hint={mode === "add" ? t("appConfig.vars.keyHint") : undefined}
          error={key.length > 0 && keyIssue ? t(KEY_ISSUE[keyIssue]) : undefined}
        >
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              className="text-start font-mono"
              value={key}
              readOnly={mode === "edit"}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          )}
        </Field>
        <Field
          label={t("appConfig.vars.valueLabel")}
          hint={mode === "edit" ? t("appConfig.vars.valueHintEdit") : t("appConfig.vars.valueHint")}
          error={valueIssue ? t(valueIssue === "nul" ? "appConfig.vars.valueIssue.nul" : "appConfig.vars.valueIssue.tooLong") : undefined}
        >
          {(p) => (
            <Textarea
              {...p}
              dir="ltr"
              rows={3}
              className="text-start font-mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
            />
          )}
        </Field>
        {mode === "edit" ? (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" size="sm" className="self-start" loading={loadingCurrent} onClick={() => void loadCurrent()}>
              <Download aria-hidden className="size-4" />
              {t("appConfig.vars.loadCurrent")}
            </Button>
            {loadError ? <ErrorNotice error={loadError} /> : null}
          </div>
        ) : null}
        {overwrites ? (
          <p role="status" className="rounded-sm bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
            {t("appConfig.vars.overwriteNote")}
          </p>
        ) : null}
        {key && isPublicEnvKey(key) ? (
          <p role="status" className="flex items-start gap-2 rounded-sm bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
            <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
            {t("appConfig.vars.publicWarning")}
          </p>
        ) : null}
      </div>
    </OpDialog>
  );
}
