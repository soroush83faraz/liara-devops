"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** ms before auto-dismiss; 0 keeps it until dismissed. Default 6000 (errors 9000). */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  variant: ToastVariant;
}

interface ToastApi {
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const variantStyle: Record<ToastVariant, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "text-accent" },
  success: { icon: CircleCheck, className: "text-ok" },
  warning: { icon: TriangleAlert, className: "text-warn" },
  error: { icon: CircleAlert, className: "text-danger" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-3), { ...input, id, variant: input.variant ?? "info" }]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The live region stays mounted so screen readers announce additions reliably. */}
      <div
        role="region"
        aria-label={t("common.toast")}
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-start"
      >
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const duration = item.duration ?? (item.variant === "error" ? 9000 : 6000);
  useEffect(() => {
    if (paused || duration === 0) return;
    const timer = setTimeout(() => onDismiss(item.id), duration);
    return () => clearTimeout(timer);
  }, [paused, duration, item.id, onDismiss]);

  const { icon: Icon, className } = variantStyle[item.variant];
  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-surface p-3 text-foreground shadow-lg animate-hl-pop"
    >
      <Icon aria-hidden className={cn("mt-1 size-5 shrink-0", className)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-7">{item.title}</p>
        {item.description ? <p className="text-sm leading-7 text-muted">{item.description}</p> : null}
      </div>
      <button
        type="button"
        aria-label={t("common.dismiss")}
        onClick={() => onDismiss(item.id)}
        className="-m-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground md:size-8"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
