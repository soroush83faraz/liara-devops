"use client";

import { ArrowDownToLine, FileArchive, Upload, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui";
import { formatBytes } from "@/lib/create/format";
import { fileProblem, type SourceFile } from "@/lib/create/wizards";
import { spring } from "@/lib/ui/motion";
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
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files?.[0]);
        }}
        data-over={over || undefined}
        className={cn(
          "flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center transition-[border-color,background-color,box-shadow] duration-200",
          over ? "border-accent bg-accent-soft/70 shadow-[var(--glow-accent)]" : "border-border-strong/50 bg-surface-muted/50 hover:border-border-strong/80",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-11 items-center justify-center rounded-sm border bg-surface transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            over ? "-translate-y-1 scale-110 border-accent text-accent" : "border-border text-muted",
          )}
        >
          {over ? <ArrowDownToLine className="size-5" /> : <Upload className="size-5" />}
        </span>
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
        <motion.div
          key={file.name}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.pop}
          className={cn("flex items-center gap-3 rounded-sm border bg-surface p-2 ps-3", problem ? "border-danger/50" : "border-accent/40")}
        >
          <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-sm", problem ? "bg-danger-soft text-danger-ink" : "bg-accent-soft text-accent-ink")}>
            <FileArchive className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <bdi dir="ltr" className="block truncate font-mono text-sm">{file.name}</bdi>
            <span className="text-xs text-muted">{formatBytes(file.size)}</span>
          </div>
          <IconButton label={tk("deploy.removeFile")} icon={<X aria-hidden className="size-4" />} onClick={() => onChange(undefined)} disabled={disabled} />
        </motion.div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm leading-6 text-danger">
          {tk(`deploy.fileProblem.${problem}`)}
        </p>
      ) : null}
    </div>
  );
}
