"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";
import { DIR } from "./dir";
import { useReturnFocus } from "./return-focus";
import { DialogOverlay } from "./dialog";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export type SheetSide = "start" | "end" | "bottom";

const sideClass: Record<SheetSide, string> = {
  start: "inset-y-0 end-auto start-0 w-[min(32rem,100vw)] border-e animate-hl-sheet-start",
  end: "inset-y-0 start-auto end-0 w-[min(32rem,100vw)] border-s animate-hl-sheet-end",
  bottom: "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-lg border-t animate-hl-sheet-bottom",
};

/** Mobile layout used when `mobileBottom` is on: a bottom sheet below the md breakpoint. */
const mobileBottomClass =
  "max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:start-0 max-md:end-0 max-md:h-auto max-md:max-h-[88dvh] max-md:w-full max-md:rounded-t-lg max-md:border-t max-md:border-s-0 max-md:border-e-0 max-md:animate-hl-sheet-bottom";

export interface SheetContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  hideTitle?: boolean;
  /** "start" is the reading-start edge (right in RTL). */
  side?: SheetSide;
  /** Render as a bottom sheet below the md breakpoint (default true for side sheets). */
  mobileBottom?: boolean;
}

export function SheetContent({
  title,
  description,
  hideTitle,
  side = "start",
  mobileBottom = true,
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: SheetContentProps) {
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  const titleNode = <DialogPrimitive.Title className="text-lg font-bold leading-snug">{title}</DialogPrimitive.Title>;
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        dir={DIR}
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed z-50 flex flex-col border-border bg-surface text-foreground shadow-[var(--shadow-pop)] outline-none",
          sideClass[side],
          mobileBottom && mobileBottomClass,
          className,
        )}
        {...props}
        {...returnFocus}
      >
        {side === "bottom" || mobileBottom ? (
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong/50 md:hidden" />
        ) : null}
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            {hideTitle ? <VisuallyHidden.Root>{titleNode}</VisuallyHidden.Root> : titleNode}
            {description ? (
              <DialogPrimitive.Description className="text-sm leading-6 text-muted">{description}</DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label={t("common.close")}
            className="-me-2 inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground active:scale-95 md:size-9"
          >
            <X aria-hidden className="size-5" />
          </DialogPrimitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
