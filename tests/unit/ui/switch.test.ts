import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "@/components/ui/switch";

describe("Switch", () => {
  const html = renderToStaticMarkup(h(Switch, { label: "پیگیری زنده", description: "توضیح", checked: true, onCheckedChange: () => undefined }));

  it("is named by its visible label (aria-labelledby points at the label text)", () => {
    const button = /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";
    const labelledby = /aria-labelledby="([^"]+)"/.exec(button)?.[1];
    expect(labelledby, "switch has aria-labelledby").toBeTruthy();
    expect(html).toMatch(new RegExp(`id="${labelledby}"[^>]*>پیگیری زنده<`));
    expect(button).toContain("aria-describedby");
  });

  it("has a hit area of at least 44 x 44 css px (h-11 w-14), not the 44 x 24 track", () => {
    const button = /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toMatch(/\bh-11\b/);
    expect(button).toMatch(/\bw-14\b/);
  });
});
