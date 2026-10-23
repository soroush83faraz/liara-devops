"use client";

import { FileArchive, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_ARCHIVE_BYTES } from "@/lib/setup/limits";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

const NAME_OK = /\.(zip|tar\.gz|tgz)$/i;

export function checkPickedFile(file: File): "wrongType" | "tooBig" | null {
  if (!NAME_OK.test(file.name)) return "wrongType";
  return file.size > MAX_ARCHIVE_BYTES ? "tooBig" : null;
}

export function UploadBox({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [problem, setProblem] = useState<"wrongType" | "tooBig" | null>(null);
  const [over, setOver] = useState(false);

  function pick(file: File | undefined) {
    if (!file) return;
    const p = checkPickedFile(file);
    setProblem(p);
    setPicked(p ? null : file);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          over ? "border-accent bg-accent-soft" : "border-border-strong/50 bg-surface",
        )}
      >
        <FileArchive aria-hidden className="size-8 text-accent" />
        <p className="text-[15px] leading-7">{t("setupFlow.upload.drop")}</p>
        <p className="text-sm text-muted">{t("setupFlow.upload.or")}</p>
        <input
          ref={input}
          type="file"
          accept=".zip,.tgz,.tar.gz,application/zip,application/gzip"
          className="sr-only"
          aria-label={t("setupFlow.upload.choose")}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
          <Upload aria-hidden className="size-4" />
          {t("setupFlow.upload.choose")}
        </Button>
        {picked ? (
          <p className="text-sm">
            {t("setupFlow.upload.selected", { name: "" })}
            <bdi dir="ltr" className="font-mono">
              {picked.name}
            </bdi>
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {t(problem === "wrongType" ? "setupFlow.upload.wrongType" : "setupFlow.upload.tooBig")}
          </p>
        ) : null}
      </div>
      <ul className="list-disc ps-5 text-xs leading-6 text-muted">
        <li>{t("setupFlow.upload.limits")}</li>
        <li>{t("setupFlow.upload.safety")}</li>
      </ul>
      <Button onClick={() => picked && onFile(picked)} disabled={!picked} loading={busy} loadingText={t("setupFlow.upload.working")} className="self-start">
        {t("setupFlow.upload.analyze")}
      </Button>
    </div>
  );
}
