// Guard: every t("a.b.c") / tk("x.y") key used in source exists in the Persian dictionary and points at a string.
import { describe, expect, it } from "vitest";
import { fa } from "@/lib/i18n/fa";
import { findAll, lineOf, listFiles, read, stripComments } from "./scan";

function lookup(path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), fa);
}

const T_CALL = /(?<![\w.$])t\(\s*(["'])([A-Za-z0-9_.]+)\1/g;
/** components/create/parts.tsx defines `tk(key) = t("createFlow." + key)`. */
const TK_CALL = /(?<![\w.$])tk\(\s*(["'])([A-Za-z0-9_.]+)\1/g;

const IMPORTS_T = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["'](?:@\/lib\/i18n(?:\/t|\/index)?|(?:\.\.?\/)+(?:lib\/)?i18n(?:\/t|\/index)?|\.\/t)["']/;

describe("i18n keys", () => {
  it("lookup works on real keys and rejects unknown ones", () => {
    expect(typeof lookup("canvasMap.title")).toBe("string");
    expect(lookup("canvasMap.doesNotExist")).toBeUndefined();
    expect(typeof lookup("canvasMap.probe")).toBe("object");
  });

  it("every statically written t('…') key exists and is a string", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const file of listFiles(["app", "components", "lib"], [".ts", ".tsx"])) {
      if (file.startsWith("lib/i18n/")) continue;
      const raw = read(file);
      const code = stripComments(raw);
      const useT = IMPORTS_T.test(raw);
      const uses: Array<{ key: string; at: number }> = [];
      if (useT) for (const m of code.matchAll(T_CALL)) uses.push({ key: m[2], at: m.index ?? 0 });
      if (file === "components/create/parts.tsx" || /const tk\s*=/.test(code)) {
        for (const m of code.matchAll(TK_CALL)) uses.push({ key: `createFlow.${m[2]}`, at: m.index ?? 0 });
      }
      for (const u of uses) {
        checked++;
        if (!u.key.includes(".")) continue; // not a dictionary path
        if (typeof lookup(u.key) !== "string") problems.push(`${file}:${lineOf(code, u.at)}  ${u.key}`);
      }
    }
    expect(checked, "scanned t() calls").toBeGreaterThan(300);
    expect(problems, "Missing or non-string dictionary keys (add them to lib/i18n/fa.ts or ns/*.ts):").toEqual([]);
  });

  it("t() is only imported from the i18n module (so the scan above sees every dictionary call)", () => {
    const stray = listFiles(["app", "components", "lib"], [".ts", ".tsx"])
      .filter((f) => !f.startsWith("lib/i18n/"))
      .flatMap((f) => findAll(f, stripComments(read(f)), /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["'](?!@\/lib\/i18n|(?:\.\.?\/)+(?:lib\/)?i18n|\.\/t["'])[^"']+["']/g));
    expect(stray, "Another module exports a `t`; import the dictionary function from @/lib/i18n:").toEqual([]);
  });
});
