import { describe, expect, it } from "vitest";
import { fa } from "@/lib/i18n/fa";
import { errorText, reasonText, sizingText, warningText } from "@/lib/setup/text";
import { analyzeFixture } from "./helpers";
import { readdirSync } from "node:fs";
import path from "node:path";

const names = readdirSync(path.join(process.cwd(), "tests/fixtures/projects")).map((f) => f.replace(".synthetic.json", ""));

describe("every machine code the detector can emit has Persian text", () => {
  it("reasons and warnings across all fixtures", async () => {
    const reasons = new Set<string>();
    const warnings = new Set<string>();
    for (const n of names) {
      const a = await analyzeFixture(n);
      a.reasons.forEach((r) => reasons.add(r.code));
      a.warnings.forEach((w) => warnings.add(w));
    }
    for (const c of reasons) expect(Object.keys(fa.setupFlow.reasons), `reason ${c}`).toContain(c);
    for (const c of warnings) expect(Object.keys(fa.setupFlow.warnings), `warning ${c}`).toContain(c);
    expect(reasons.size).toBeGreaterThan(15);
  });

  it("every reason/warning string is Persian prose without leaking unfilled placeholders", async () => {
    const a = await analyzeFixture("nextjs");
    for (const r of a.reasons) {
      const text = reasonText(r);
      expect(text).toMatch(/[\u0600-\u06FF]/);
      expect(text).not.toMatch(/\{\w+\}/);
    }
    expect(warningText("no_lockfile")).toMatch(/[\u0600-\u06FF]/);
  });

  it("sizing codes and error codes resolve", () => {
    expect(sizingText({ code: "need_base_next" }, { ramGb: 1, cpu: 0.5 })).toContain("Next.js");
    expect(sizingText({ code: "need_orm" })).not.toBe("");
    expect(sizingText({ code: "plan_smallest_sufficient" })).not.toBe("");
    expect(errorText("bomb")).toBe(fa.setupFlow.errors.bomb);
    expect(errorText("nonsense")).toBe(fa.setupFlow.errors.generic);
  });

  it("the explanation for a user-facing reason mentions the decisive file", async () => {
    const a = await analyzeFixture("nextjs");
    const why = a.reasons.map(reasonText).join(" ");
    expect(why).toContain("package.json");
    expect(why).toContain("Next.js");
  });
});
