"use client";

import { useReducer, useRef, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { deployReducer, canAdvanceDeploy, DEPLOY_STEPS, deployTypedOk, initialDeployState } from "@/lib/create/wizards";
import { DeployRequestError, uploadDeploy } from "@/lib/create/deploy-client";
import { errorKeyFor, toErrLike } from "@/lib/create/errors";
import { formatBytes } from "@/lib/create/format";
import { suggestPort, validateImage, validatePort } from "@/lib/create/validators";
import { PLATFORMS } from "@/lib/contracts/common";
import { Dropzone } from "./dropzone";
import { DeployProgress } from "./deploy-progress";
import { CardGrid, NavFooter, OptionCard, SubmitError, TypedField, WizardDialog, tk } from "./parts";

export function DeployDialog({ appName, platform, onClose }: { appName: string; platform?: string; onClose: () => void }) {
  const platforms: readonly string[] = PLATFORMS;
  const [s, dispatch] = useReducer(deployReducer, undefined, () => initialDeployState(appName, platform));
  const [progress, setProgress] = useState<number | null>(null);
  const inflight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const busy = s.submit.phase === "pending";

  async function submit() {
    if (inflight.current || !deployTypedOk(s)) return;
    inflight.current = true;
    dispatch({ type: "submit_start" });
    setProgress(0);
    abort.current = new AbortController();
    try {
      const { releaseId } = await uploadDeploy(
        {
          appName,
          typedName: s.typedName.trim(),
          port: s.port,
          kind: s.sourceKind,
          file: s.file?.blob,
          fileName: s.file?.name,
          platform: s.platform,
          image: s.image.trim(),
        },
        (loaded, total) => setProgress(total ? loaded / total : null),
        abort.current.signal,
      );
      dispatch({ type: "submit_success", releaseId });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const err = toErrLike(e);
      dispatch({ type: "submit_error", errorKey: errorKeyFor(err, "deploy"), retryAfterSec: e instanceof DeployRequestError ? e.retryAfterSec : err.retryAfterSec });
    } finally {
      inflight.current = false;
      setProgress(null);
    }
  }

  const stepIndex = DEPLOY_STEPS.indexOf(s.step);
  const labels = DEPLOY_STEPS.map((k) => tk(`deploy.steps.${k}`));
  const back = s.step === "source" || s.step === "progress" ? undefined : () => dispatch({ type: "back" });

  let footer = null;
  if (s.step === "review") {
    footer = <NavFooter onCancel={onClose} onBack={back} onNext={() => void submit()} nextLabel={busy ? tk("deploy.uploading") : tk("deploy.submit")} nextDisabled={!deployTypedOk(s)} busy={busy} />;
  } else if (s.step !== "progress") {
    footer = <NavFooter onCancel={onClose} onBack={back} onNext={() => dispatch({ type: "next" })} nextDisabled={!canAdvanceDeploy(s, platforms)} />;
  }

  return (
    <WizardDialog title={tk("deploy.title")} description={tk("deploy.description", { name: appName })} stepLabels={labels} stepIndex={stepIndex} busy={busy} onClose={onClose} footer={footer}>
      {s.step === "source" ? (
        <div className="flex flex-col gap-4">
          <h4 className="text-sm font-semibold">{tk("deploy.sourceTitle")}</h4>
          <CardGrid label={tk("deploy.sourceTitle")}>
            <OptionCard name="kind" value="archive" checked={s.sourceKind === "archive"} onChange={() => dispatch({ type: "set_kind", kind: "archive" })} title={tk("deploy.kindArchive")} subtitle={tk("deploy.kindArchiveHint")} />
            <OptionCard name="kind" value="image" checked={s.sourceKind === "image"} onChange={() => dispatch({ type: "set_kind", kind: "image" })} title={tk("deploy.kindImage")} subtitle={tk("deploy.kindImageHint")} />
          </CardGrid>
          {s.sourceKind === "archive" ? (
            <Dropzone file={s.file} onChange={(file) => dispatch({ type: "set_file", file })} />
          ) : (
            <Field label={tk("deploy.imageLabel")} hint={tk("deploy.imageHint")} error={s.image && validateImage(s.image) ? tk(`validation.${validateImage(s.image)}`) : undefined}>
              {(p) => <Input {...p} dir="ltr" autoComplete="off" autoCapitalize="off" spellCheck={false} value={s.image} onChange={(e) => dispatch({ type: "set_image", image: e.target.value })} placeholder="nginx:1.27" className="text-start font-mono" />}
            </Field>
          )}
        </div>
      ) : null}

      {s.step === "config" ? (
        <div className="flex flex-col gap-4">
          {s.sourceKind === "archive" ? (
            <Field label={tk("deploy.platformLabel")} hint={tk("deploy.platformHint")}>
              {(p) => <Select {...p} value={s.platform} onValueChange={(platform) => dispatch({ type: "set_platform", platform })} options={platforms.map((x) => ({ value: x, label: platformLabel(x) }))} />}
            </Field>
          ) : (
            <p className="text-sm text-muted">{tk("deploy.imagePlatformNote")}</p>
          )}
          <Field
            label={tk("deploy.portLabel")}
            hint={suggestPort(s.platform) && s.sourceKind === "archive" ? tk("deploy.portHint", { port: String(suggestPort(s.platform)) }) : undefined}
            error={s.port && validatePort(s.port) ? tk("validation.portInvalid") : undefined}
          >
            {(p) => <Input {...p} dir="ltr" inputMode="numeric" autoComplete="off" value={s.port} onChange={(e) => dispatch({ type: "set_port", port: e.target.value })} className="text-start font-mono" />}
          </Field>
          <p className="text-xs leading-6 text-muted">{tk("deploy.envNote")}</p>
        </div>
      ) : null}

      {s.step === "review" ? (
        <div className="flex flex-col gap-4">
          <h4 className="text-sm font-semibold">{tk("deploy.reviewTitle")}</h4>
          <dl className="divide-y divide-border rounded-xl border border-border px-3">
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-sm text-muted">{tk("deploy.summarySource")}</dt>
              <dd className="min-w-0 text-sm font-medium">
                <bdi dir="ltr" className="break-all font-mono">
                  {s.sourceKind === "archive" && s.file ? `${s.file.name} (${formatBytes(s.file.size)})` : s.image}
                </bdi>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-sm text-muted">{tk("deploy.summaryPlatform")}</dt>
              <dd className="text-sm font-medium"><bdi dir="ltr">{s.sourceKind === "image" ? "Docker" : platformLabel(s.platform)}</bdi></dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-sm text-muted">{tk("deploy.summaryPort")}</dt>
              <dd className="text-sm font-medium"><bdi dir="ltr" className="font-mono">{s.port}</bdi></dd>
            </div>
          </dl>
          <p className="text-xs leading-6 text-muted">{tk("deploy.costNote")}</p>
          <p className="text-xs leading-6 text-muted">{tk("deploy.dailyCapNote")}</p>
          <TypedField label={tk("typed.label")} name={appName} value={s.typedName} onChange={(typed) => dispatch({ type: "set_typed", typed })} disabled={busy} />
          {busy && progress !== null ? <progress className="h-2 w-full" max={1} value={progress} aria-label={tk("deploy.uploading")} /> : null}
          <SubmitError submit={s.submit} />
        </div>
      ) : null}

      {s.step === "progress" && s.releaseId ? (
        <DeployProgress appName={appName} releaseId={s.releaseId} onFinish={onClose} onRetry={() => dispatch({ type: "restart" })} />
      ) : null}
    </WizardDialog>
  );
}

function platformLabel(p: string): string {
  const v = tk(`platforms.${p}.label`) as string;
  return v.startsWith("createFlow.") ? p : v;
}
