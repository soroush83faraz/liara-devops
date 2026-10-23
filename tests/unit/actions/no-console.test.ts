// Grep-style guard: no file under lib/actions may log params/values. The only console call lives in log.ts and
// prints a fixed event code plus an error class name.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../lib/actions");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("lib/actions logging", () => {
  const files = sources(ROOT);

  it("scans the whole module", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no console.* outside log.ts", () => {
    const offenders = files.filter((f) => path.basename(f) !== "log.ts" && /\bconsole\s*[.[]/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("log.ts makes one console call with a fixed format (event code + error class)", () => {
    const text = readFileSync(path.join(ROOT, "log.ts"), "utf8");
    const calls = text.match(/console\.[a-z]+\([^)]*\)/g) ?? [];
    expect(calls).toEqual(["console.error(`[actions] ${event}`, code ? `${name}:${code}` : name)"]);
  });

  it("no file stringifies user values, params or bodies into logs or errors", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, path.relative(ROOT, f)).not.toMatch(/safeLog\([^)]*(userValues|params|body|value)/);
      expect(text, path.relative(ROOT, f)).not.toMatch(/new (?:Action|Flow)Error\([^)]*\.message/);
    }
  });
});
