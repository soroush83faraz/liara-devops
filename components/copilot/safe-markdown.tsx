import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { parseSafeMarkdown, type Inline } from "@/lib/copilot/safe-markdown";

function InlineNodes({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.t === "text" ? (
          <Fragment key={i}>{p.v}</Fragment>
        ) : p.t === "bold" ? (
          <strong key={i} className="font-semibold">
            {p.v}
          </strong>
        ) : (
          <bdi key={i} dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono text-[0.875em]">
            {p.v}
          </bdi>
        ),
      )}
    </>
  );
}

/**
 * Renders model-written prose. Only React text nodes are produced (no HTML, no links, no images): everything
 * outside paragraphs / bold / lists / code is shown literally.
 */
export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseSafeMarkdown(text);
  return (
    <div className={cn("flex flex-col gap-2 text-[15px] leading-8", className)}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p":
            return (
              <p key={i} className="whitespace-pre-line break-words">
                <InlineNodes parts={b.v} />
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.t === "ul" ? "ul" : "ol";
            return (
              <List key={i} className={cn("ms-5 flex flex-col gap-1 break-words", b.t === "ul" ? "list-disc" : "list-decimal")}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <InlineNodes parts={it} />
                  </li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre
                key={i}
                dir="ltr"
                className="overflow-x-auto rounded-lg border border-border bg-code-bg p-3 text-start font-mono text-[13px] leading-6 text-code-fg"
              >
                {b.v}
              </pre>
            );
        }
      })}
    </div>
  );
}
