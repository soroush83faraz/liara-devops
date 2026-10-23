"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";
import { DIR } from "./dir";
import { useReturnFocus } from "./return-focus";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-40 bg-overlay animate-hl-fade", className)}
      {...props}
    />
  );
}

const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

export interface DialogContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  /** Required: every dialog is labelled. */
  title: ReactNode;
  description?: ReactNode;
  /** Keep the title for screen readers only. */
  hideTitle?: boolean;
  footer?: ReactNode;
  size?: keyof typeof sizes;
  hideClose?: boolean;
}

/**
 * Modal dialog: focus is trapped and restored, Esc closes, labelled by title/description.
 * On phones it docks to the bottom edge like a sheet.
 */
export function DialogContent({
  title,
  description,
  hideTitle,
  footer,
  size = "md",
  hideClose,
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DialogContentProps) {
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  const titleNode = (
    <DialogPrimitive.Title className="text-lg font-semibold leading-8">{title}</DialogPrimitive.Title>
  );
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        dir={DIR}
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed z-50 flex max-h-[90dvh] w-full flex-col border border-border bg-surface text-foreground shadow-lg",
          "inset-x-0 bottom-0 rounded-t-2xl animate-hl-sheet-bottom",
          "sm:inset-x-auto sm:start-1/2 sm:bottom-auto sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-y-1/2 sm:rounded-2xl sm:animate-hl-pop",
          "sm:ltr:-translate-x-1/2 sm:rtl:translate-x-1/2",
          sizes[size],
          className,
        )}
        {...props}
        {...returnFocus}
      >
        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            {hideTitle ? <VisuallyHidden.Root>{titleNode}</VisuallyHidden.Root> : titleNode}
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm leading-7 text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close
              aria-label={t("common.close")}
              className="-me-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground md:size-9"
            >
              <X aria-hidden className="size-5" />
            </DialogPrimitive.Close>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </footer>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
