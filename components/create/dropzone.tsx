"use client";

import { FileArchive, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui";
import { formatBytes } from "@/lib/create/format";
import { fileProblem, type SourceFile } from "@/lib/create/wizards";
import { cn } from "@/lib/utils";
import { tk } from "./parts";

/** Drag & drop (or button) picker for one archive. The size/type check is client-side only; the server re-checks. */
export function Dropzone({ file, onChange, disabled }: { file?: SourceFile; onChange: (f: SourceFile | undefined) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const problem = file ? fileProblem(file) : null;

  const take = (f: File | undefined | null) => {
    if (f) onChange({ name: f.name, size: f.size, blob: f });
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          over ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-muted",
        )}
      >
        <Upload aria-hidden className="size-6 text-muted" />
        <p className="text-sm font-medium">{tk("deploy.dropTitle")}</p>
        <p className="text-xs text-muted">
          {tk("deploy.dropOr")} · {tk("deploy.dropLimit")}
        </p>
        <input
          ref={input}
          type="file"
          accept=".zip,.tar.gz,.tgz,application/zip,application/gzip"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
          {tk("deploy.chooseFile")}
        </Button>
      </div>
      {file ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2 ps-3">
          <FileArchive aria-hidden className="size-5 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <bdi dir="ltr" className="block truncate font-mono text-sm">{file.name}</bdi>
            <span className="text-xs text-muted">{formatBytes(file.size)}</span>
          </div>
          <IconButton label={tk("deploy.removeFile")} icon={<X aria-hidden className="size-4" />} onClick={() => onChange(undefined)} disabled={disabled} />
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm leading-6 text-danger">
          {tk(`deploy.fileProblem.${problem}`)}
        </p>
      ) : null}
    </div>
  );
}
