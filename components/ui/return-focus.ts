"use client";

import { useRef } from "react";

type FocusHandler = (event: Event) => void;

/**
 * Radix only returns focus to a `<DialogTrigger>`. Dialogs and sheets in this product are mostly opened by
 * controlled state from an ordinary button, so on close Radix had nothing to focus and focus fell to <body>.
 * This remembers the element that had focus when the content opened and refocuses it on close, unless the
 * consumer's own `onCloseAutoFocus` calls `preventDefault()` (it then owns focus).
 */
export function useReturnFocus(onOpenAutoFocus?: FocusHandler, onCloseAutoFocus?: FocusHandler) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const el = opener.current;
      opener.current = null;
      if (el && el.isConnected && !el.hasAttribute("disabled")) {
        event.preventDefault();
        el.focus({ preventScroll: true });
      }
    },
  };
}
