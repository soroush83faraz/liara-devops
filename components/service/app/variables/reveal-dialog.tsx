"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, CopyButton, Dialog, DialogContent } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { appPath, postJson } from "@/lib/service/app-config/client";
import type { RevealEnvDto } from "@/lib/service/app-config/dto";
import { describeError, type DescribedError } from "@/lib/service/app-config/errors";
import { ErrorNotice } from "@/lib/service/app-config/ui/error-notice";

export const REVEAL_SECONDS = 15;

/**
 * Shows one value on explicit request (audited server-side). The value is held in component state only,
 * hidden again after 15 s, and dropped on close; it never enters the query cache.
 */
export function RevealDialog({ appName, envKey, onClose }: { appName: string; envKey: string; onClose: () => void }) {
  const [value, setValue] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DescribedError | null>(null);

  const visible = value !== null;
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          setValue(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [visible]);

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await postJson<RevealEnvDto>(`${appPath(appName, "envs")}/reveal`, { key: envKey });
      setValue(res.value);
      setLeft(REVEAL_SECONDS);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  function hide() {
    setValue(null);
    setLeft(0);
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        title={t("appConfig.vars.revealTitle")}
        description={t("appConfig.vars.revealBody")}
        footer={
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <bdi dir="ltr" className="font-mono font-semibold">
              {envKey}
            </bdi>
          </p>
          {value !== null ? (
            <div className="flex flex-col gap-2">
              <pre
                dir="ltr"
                className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-code-bg p-3 text-start font-mono text-[13px] text-code-fg"
              >
                {value === "" ? t("appConfig.vars.emptyValue") : value}
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton value={value} label={t("common.copy")} size="sm" />
                <Button variant="ghost" size="sm" onClick={hide}>
                  <EyeOff aria-hidden className="size-4" />
                  {t("common.hide")}
                </Button>
                <span role="timer" className="text-xs text-muted">
                  {t("appConfig.vars.autoHide", { seconds: left })}
                </span>
              </div>
            </div>
          ) : (
            <Button className="self-start" loading={loading} onClick={() => void reveal()}>
              <Eye aria-hidden className="size-4" />
              {t("appConfig.vars.revealAction")}
            </Button>
          )}
          {error ? <ErrorNotice error={error} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
