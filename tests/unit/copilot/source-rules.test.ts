import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const DIRS = ["components/copilot", "components/service/copilot", "lib/copilot", "app/(shell)/incidents", "app/(shell)/activity"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = DIRS.flatMap((d) => files(join(ROOT, d))).map((p) => ({ path: p.replace(ROOT, ""), text: readFileSync(p, "utf8") }));

describe("copilot source rules", () => {
  it("finds the sources", () => expect(sources.length).toBeGreaterThan(30));

  it("never uses dangerouslySetInnerHTML, innerHTML or eval-like sinks", () => {
    for (const s of sources) {
      expect(s.text, s.path).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|new Function\(|\beval\(/);
    }
  });

  it("keeps Persian text in the i18n namespaces only", () => {
    const persian = /[؀-ۿ]/;
    for (const s of sources) {
      const code = s.text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, s.path).not.toMatch(persian);
    }
  });

  it("uses logical Tailwind utilities (no physical left/right spacing)", () => {
    for (const s of sources) {
      expect(s.text, s.path).not.toMatch(/className="[^"]*\b(?:ml|mr|pl|pr|left|right|text-left|text-right|rounded-l|rounded-r|border-l|border-r)-/);
    }
  });

  it("approval and API code never logs or stores secrets", () => {
    for (const s of sources.filter((x) => /approval|\/api\.ts/.test(x.path))) {
      expect(s.text, s.path).not.toMatch(/console\.|localStorage|useMutation|setQueryData/);
    }
  });

  it("the mock is imported dynamically behind a production guard only", () => {
    const importers = sources.filter((s) => /mock-stream"/.test(s.text) && !s.path.includes("mock-stream.ts"));
    expect(importers.map((s) => s.path)).toEqual(["/lib/copilot/http.ts"]);
    const http = sources.find((s) => s.path === "/lib/copilot/http.ts")!.text;
    expect(http).toMatch(/NODE_ENV !== "production"[\s\S]*import\("\.\/mock-stream"\)/);
    expect(http).toMatch(/NODE_ENV === "production"\) return false/);
  });
});
