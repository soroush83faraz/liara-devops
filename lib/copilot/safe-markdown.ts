// Tiny markdown subset for model-written prose: paragraphs, **bold**, `code`, bullet/numbered lists, fenced code.
// Output is an AST of plain strings. The renderer (components/copilot/safe-markdown.tsx) emits React text nodes
// only, so there is no HTML, no links, no images and no entity decoding: everything else stays literal text.
import { stripUnsafeChars } from "./text";

export type Inline = { t: "text"; v: string } | { t: "bold"; v: string } | { t: "code"; v: string };
export type Block =
  | { t: "p"; v: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "code"; v: string };

export const MAX_MARKDOWN_CHARS = 20_000;

const INLINE_TOKEN = /(`[^`\n]+`|\*\*[^*\n]+?\*\*)/g;
const FENCE = /^\s*```/;
const UL_ITEM = /^\s*(?:[-*•])\s+(.*)$/;
const OL_ITEM = /^\s*(?:[0-9\u06F0-\u06F9\u0660-\u0669]{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ t: "text", v: text.slice(last, start) });
    const tok = m[0];
    if (tok.startsWith("`")) out.push({ t: "code", v: tok.slice(1, -1) });
    else out.push({ t: "bold", v: tok.slice(2, -2) });
    last = start + tok.length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** Parses the subset. Anything outside it (HTML, links, images, tables, entities) is kept as literal text. */
export function parseSafeMarkdown(source: string): Block[] {
  const clipped = source.length > MAX_MARKDOWN_CHARS ? source.slice(0, MAX_MARKDOWN_CHARS) : source;
  const lines = stripUnsafeChars(clipped).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: Inline[][] } | null = null;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ t: "p", v: parseInline(para.join("\n")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: list.kind, items: list.items });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flushPara();
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      blocks.push({ t: "code", v: code.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const ul = UL_ITEM.exec(line);
    const ol = ul ? null : OL_ITEM.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list && list.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push(parseInline((ul ?? ol)![1]));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ t: "p", v: [{ t: "bold", v: heading[1] }] });
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain-text projection (used for aria labels and copy): no markers, no markup. */
export function markdownToPlain(source: string): string {
  const inline = (parts: Inline[]) => parts.map((p) => p.v).join("");
  return parseSafeMarkdown(source)
    .map((b) => (b.t === "p" ? inline(b.v) : b.t === "code" ? b.v : b.items.map((it) => `• ${inline(it)}`).join("\n")))
    .join("\n\n");
}
