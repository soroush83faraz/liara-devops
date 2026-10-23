"use client";

import { Command, Search, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { serviceIcon } from "@/components/canvas/service-icon";
import { useShellStore } from "@/components/shell/shell-store";
import { emptyAwareDir } from "@/components/ui/dir";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useOverview } from "@/lib/canvas/use-overview";
import { fa } from "@/lib/i18n/fa";
import { buildCommandItems, isCommandShortcut, type CommandItem } from "@/lib/copilot/command";
import { shouldSubmitOnEnter } from "@/lib/copilot/keys";
import { useCopilotStore } from "@/lib/copilot/store";
import { fill } from "@/lib/copilot/text";
import { spring } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

const l = fa.copilotUi.command;

/**
 * ⌘/Ctrl+K palette: choose a service (from the shared overview query) or type a question; either way the
 * service's «همیار» tab opens, and a typed question is sent there. Wire it into the TopBar (e.g. next to the
 * health-watch indicator). It must render inside the app's QueryClientProvider.
 */
export function GlobalCommandBar({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCommandShortcut(e)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={l.trigger}
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm text-muted",
          "hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-10",
          className,
        )}
      >
        <Search aria-hidden className="size-4" />
        <span className="hidden lg:inline">{l.trigger}</span>
        <span className="hidden lg:inline-flex lg:items-center lg:gap-0.5" aria-hidden>
          <Kbd>
            <Command className="size-3" />
          </Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <Palette onClose={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isPending, isError } = useOverview();
  const [query, setQuery] = useState("");
  // null: the default for this query. Picking a service: the first one. A question: a service it names, or the
  // service whose panel is open; otherwise nothing (-1), so Enter never sends the question to an unrelated service.
  const [active, setActive] = useState<number | null>(null);
  const listId = useId();
  const openService = useShellStore((s) => (s.servicePanel.open ? s.servicePanel.service : undefined));

  const items = useMemo(() => buildCommandItems(data?.services ?? [], query), [data, query]);
  const platformOf = useMemo(() => new Map((data?.services ?? []).map((s) => [s.id, s.platformOrEngine])), [data]);
  const asking = items[0]?.mode === "ask";
  const fallback = asking ? items.findIndex((it) => it.related || it.service.id === openService) : 0;
  const index = Math.min(active ?? fallback, items.length - 1);

  const choose = useCallback(
    (item: CommandItem) => {
      const key = `${item.service.kind}:${item.service.name}`;
      if (item.mode === "ask" && item.question) useCopilotStore.getState().queueQuestion(key, item.question);
      if (pathname === "/") {
        useShellStore.getState().openService(item.service.id, "copilot");
      } else {
        router.push(`/?service=${encodeURIComponent(item.service.id)}&tab=copilot`);
      }
      onClose();
    },
    [pathname, router, onClose],
  );

  return (
    <DialogContent title={l.title} description={l.description} hideTitle size="md">
      <motion.div initial={{ opacity: 0, y: -6, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.pop} className="flex flex-col">
        <div className="relative rounded-md border border-border-strong/50 bg-surface transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_16%,transparent)]">
          <Search aria-hidden className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={index >= 0 ? `${listId}-${index}` : undefined}
            aria-label={l.inputLabel}
            placeholder={l.placeholder}
            dir={emptyAwareDir(query)}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.min(items.length - 1, index + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(0, index - 1));
              } else if (shouldSubmitOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
                e.preventDefault();
                if (items[index]) choose(items[index]);
              }
            }}
            className="min-h-12 rounded-md border-0 bg-transparent px-11 text-base shadow-none focus-visible:outline-none! focus-visible:ring-0"
          />
        </div>
        <div className="pt-2">
          {isPending ? (
            <div aria-busy className="flex flex-col gap-2 p-1">
              <p className="px-2 text-sm text-muted">{l.loading}</p>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <p role="alert" className="p-3 text-sm text-danger">
              {l.failed}
            </p>
          ) : items.length === 0 ? (
            <p role="status" className="py-8 text-center text-sm text-muted">
              {l.empty}
            </p>
          ) : (
            <>
              {asking ? <p className="px-1 pb-1.5 text-xs text-muted">{l.askPick}</p> : null}
              <ul id={listId} role="listbox" aria-label={l.services} className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                {items.map((item, i) => {
                  const Icon = serviceIcon(item.service.kind, platformOf.get(item.service.id) ?? "");
                  const selected = i === index;
                  return (
                    <li
                      key={item.service.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(i)}
                      onClick={() => choose(item)}
                      className="relative flex min-h-12 cursor-pointer items-center gap-3 rounded-sm px-3 py-2"
                    >
                      {selected ? (
                        <motion.span
                          layoutId="command-active"
                          transition={spring.pop}
                          aria-hidden
                          className="absolute inset-0 rounded-sm border border-accent/30 bg-accent-soft"
                        />
                      ) : null}
                      <span
                        aria-hidden
                        className={cn(
                          "relative flex size-8 shrink-0 items-center justify-center rounded-sm border",
                          selected ? "border-accent/40 bg-surface text-accent-ink" : "border-border bg-surface-muted text-muted",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className={cn("relative min-w-0 flex-1", selected && "text-accent-ink")}>
                        <bdi dir="ltr" className="font-mono text-sm font-semibold">
                          {item.service.name}
                        </bdi>
                        <span className={cn("ms-2 text-xs", selected ? "text-accent-ink/80" : "text-muted")}>{item.service.kind === "db" ? l.typeDb : l.typeApp}</span>
                        <span className={cn("block truncate text-xs", selected ? "text-accent-ink/90" : "text-muted")}>
                          {item.mode === "ask" ? fill(l.askAbout, { name: item.service.name }) : fill(l.openCopilot, { name: item.service.name })}
                        </span>
                      </span>
                      <span aria-hidden className={cn("relative flex items-center gap-1 transition-opacity", selected ? "opacity-100" : "opacity-0")}>
                        <Kbd>↵</Kbd>
                      </span>
                      <Sparkles aria-hidden className={cn("relative size-4 shrink-0", selected ? "text-accent-ink" : "text-muted")} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <p className="mt-2 border-t border-border pt-3 text-xs text-muted">
          {l.hintKeys}
        </p>
      </motion.div>
    </DialogContent>
  );
}
