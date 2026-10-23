"use client";

import { ArrowDownToLine, CircleCheck, CircleX, FileArchive, Info, ShieldCheck, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_ARCHIVE_BYTES } from "@/lib/setup/limits";
import { formatBytes } from "@/lib/service/db/format";
import { t } from "@/lib/i18n/t";
import { spring } from "@/lib/ui/motion";
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
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
        data-over={over || undefined}
        className={cn(
          "group relative flex flex-col items-center gap-3 overflow-hidden rounded-md border border-dashed px-6 py-9 text-center",
          "transition-[border-color,background-color,box-shadow] duration-200",
          over
            ? "border-accent bg-accent-soft/70 shadow-[var(--glow-accent)]"
            : picked
              ? "border-accent/50 bg-surface"
              : "border-border-strong/45 bg-surface hover:border-border-strong/80",
        )}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-dot-grid opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        <span
          aria-hidden
          className={cn(
            "relative flex size-14 items-center justify-center rounded-md border transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            over ? "-translate-y-1 scale-110 border-accent bg-surface text-accent" : "border-border bg-surface-muted text-accent",
          )}
        >
          {over ? <ArrowDownToLine className="size-6" /> : <FileArchive className="size-6" />}
        </span>
        <p className="relative text-[15px] font-medium leading-7">{t("setupFlow.upload.drop")}</p>
        <p className="relative text-sm text-muted">{t("setupFlow.upload.or")}</p>
        <input
          ref={input}
          type="file"
          accept=".zip,.tgz,.tar.gz,application/zip,application/gzip"
          className="sr-only"
          aria-label={t("setupFlow.upload.choose")}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy} className="relative">
          <Upload aria-hidden className="size-4" />
          {t("setupFlow.upload.choose")}
        </Button>
        <AnimatePresence initial={false}>
          {picked ? (
            <motion.p
              key={picked.name}
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={spring.pop}
              className="relative inline-flex max-w-full items-center gap-2 rounded-sm border border-accent/30 bg-accent-soft px-3 py-1.5 text-sm text-accent-ink"
            >
              <CircleCheck aria-hidden className="size-4 shrink-0" />
              <span className="sr-only">{t("setupFlow.upload.selected", { name: "" })}</span>
              <bdi dir="ltr" className="min-w-0 truncate font-mono text-[13px]">
                {picked.name}
              </bdi>
              <span className="shrink-0 text-xs opacity-80" data-numeric>
                {formatBytes(picked.size)}
              </span>
            </motion.p>
          ) : null}
        </AnimatePresence>
        {problem ? (
          <p role="alert" className="relative inline-flex items-center gap-1.5 text-sm font-medium text-danger animate-hl-shake">
            <CircleX aria-hidden className="size-4 shrink-0" />
            {t(problem === "wrongType" ? "setupFlow.upload.wrongType" : "setupFlow.upload.tooBig")}
          </p>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1 text-xs leading-6 text-muted">
        <li className="flex items-start gap-2">
          <Info aria-hidden className="mt-1 size-3.5 shrink-0" />
          {t("setupFlow.upload.limits")}
        </li>
        <li className="flex items-start gap-2">
          <ShieldCheck aria-hidden className="mt-1 size-3.5 shrink-0" />
          {t("setupFlow.upload.safety")}
        </li>
      </ul>
      <Button onClick={() => picked && onFile(picked)} disabled={!picked} loading={busy} loadingText={t("setupFlow.upload.working")} className="self-start">
        {t("setupFlow.upload.analyze")}
      </Button>
    </div>
  );
}
