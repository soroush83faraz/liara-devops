import { describe, expect, it } from "vitest";
import { markdownToPlain, parseSafeMarkdown, MAX_MARKDOWN_CHARS, type Block, type Inline } from "@/lib/copilot/safe-markdown";
import { stripUnsafeChars } from "@/lib/copilot/text";

const texts = (blocks: Block[]): string[] =>
  blocks.flatMap((b): string[] => {
    if (b.t === "code") return [b.v];
    if (b.t === "p") return b.v.map((i: Inline) => i.v);
    return b.items.flatMap((it) => it.map((i) => i.v));
  });

describe("safe markdown", () => {
  it("parses paragraphs, bold, inline code, lists and fenced code", () => {
    const blocks = parseSafeMarkdown("سلام **دنیا** با `KEY`\n\n- یک\n- دو\n\n1. اول\n2. دوم\n\n```\nGET /\n```");
    expect(blocks.map((b) => b.t)).toEqual(["p", "ul", "ol", "code"]);
    const p = blocks[0] as Extract<Block, { t: "p" }>;
    expect(p.v.map((i) => i.t)).toEqual(["text", "bold", "text", "code"]);
    expect((blocks[1] as Extract<Block, { t: "ul" | "ol" }>).items).toHaveLength(2);
    expect((blocks[3] as Extract<Block, { t: "code" }>).v).toBe("GET /");
  });

  it("keeps script tags and HTML as literal text (the renderer only emits text nodes)", () => {
    const blocks = parseSafeMarkdown('<script>alert(1)</script> <img src=x onerror="alert(2)"> <b>bold</b>');
    expect(blocks).toHaveLength(1);
    expect(texts(blocks).join("")).toBe('<script>alert(1)</script> <img src=x onerror="alert(2)"> <b>bold</b>');
  });

  it("does not create links: javascript: URLs stay plain text", () => {
    const md = "[click](javascript:alert(1)) and ![x](data:text/html,<script>) and <a href=\"javascript:1\">a</a>";
    const blocks = parseSafeMarkdown(md);
    const all = texts(blocks).join("");
    expect(all).toContain("[click](javascript:alert(1))");
    expect(blocks.every((b) => b.t === "p")).toBe(true);
    expect(JSON.stringify(blocks)).not.toContain('"href"');
  });

  it("does not decode HTML entities", () => {
    expect(texts(parseSafeMarkdown("&lt;script&gt; &amp; &#60;"))[0]).toBe("&lt;script&gt; &amp; &#60;");
  });

  it("strips bidi override/isolate controls but keeps ZWNJ", () => {
    const evil = "abc‮def⁦ghi⁩ می‌خواهم";
    const out = texts(parseSafeMarkdown(evil)).join("");
    expect(out).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(out).toContain("می‌خواهم"); // ZWNJ survives
    expect(stripUnsafeChars("x\u0000y\u001Bz")).toBe("xyz");
  });

  it("treats headings as bold paragraphs and unmatched markers literally", () => {
    const blocks = parseSafeMarkdown("# عنوان\n\n**unclosed and `tick");
    expect((blocks[0] as Extract<Block, { t: "p" }>).v[0]).toEqual({ t: "bold", v: "عنوان" });
    expect(texts([blocks[1]]).join("")).toBe("**unclosed and `tick");
  });

  it("caps very long input", () => {
    const blocks = parseSafeMarkdown("a".repeat(MAX_MARKDOWN_CHARS * 2));
    expect(texts(blocks).join("").length).toBeLessThanOrEqual(MAX_MARKDOWN_CHARS);
  });

  it("projects to plain text", () => {
    expect(markdownToPlain("**a** و `b`\n\n- x")).toBe("a و b\n\n• x");
  });
});
