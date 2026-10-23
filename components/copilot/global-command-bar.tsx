"use client";

import { Bot, Command, Database, Search, Server } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
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
          "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted",
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
  const [active, setActive] = useState(0);
  const listId = useId();

  const items = useMemo(() => buildCommandItems(data?.services ?? [], query), [data, query]);
  const index = Math.min(active, Math.max(0, items.length - 1));

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
      <div className="flex flex-col gap-3">
        <Input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={items.length > 0 ? `${listId}-${index}` : undefined}
          aria-label={l.inputLabel}
          placeholder={l.placeholder}
          dir={emptyAwareDir(query)}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (shouldSubmitOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
              e.preventDefault();
              if (items[index]) choose(items[index]);
            }
          }}
        />
        {isPending ? (
          <div aria-busy className="flex flex-col gap-2">
            <p className="text-sm text-muted">{l.loading}</p>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : isError ? (
          <p role="alert" className="text-sm text-danger">
            {l.failed}
          </p>
        ) : items.length === 0 ? (
          <p role="status" className="py-4 text-center text-sm text-muted">
            {l.empty}
          </p>
        ) : (
          <ul id={listId} role="listbox" aria-label={l.services} className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {items.map((item, i) => {
              const Icon = item.service.kind === "db" ? Database : Server;
              return (
                <li
                  key={item.service.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2",
                    i === index ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-muted",
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <bdi dir="ltr" className="font-mono text-sm font-medium">
                      {item.service.name}
                    </bdi>
                    <span className="ms-2 text-xs text-muted">{item.service.kind === "db" ? l.typeDb : l.typeApp}</span>
                    <span className="block text-xs">
                      {item.mode === "ask" ? fill(l.askAbout, { name: item.service.name }) : fill(l.openCopilot, { name: item.service.name })}
                    </span>
                  </span>
                  <Bot aria-hidden className="size-4 shrink-0 text-muted" />
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted">{l.hintKeys}</p>
      </div>
    </DialogContent>
  );
}
