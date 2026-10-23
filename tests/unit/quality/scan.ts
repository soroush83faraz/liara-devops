// Small file-scanning helpers shared by the repo-wide guard tests in this folder. Not a test file.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const ROOT = join(__dirname, "..", "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "data", "coverage", "out", "build", "test-results"]);

/** All files under `dir` (relative to the repo root) whose extension is in `exts`, as posix paths. */
export function listFiles(dirs: string[], exts: string[]): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(abs, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (exts.some((e) => name.endsWith(e))) out.push(relative(ROOT, p).split(sep).join("/"));
    }
  };
  for (const d of dirs) walk(join(ROOT, d));
  return out.sort();
}

export const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/**
 * Removes // and /* *\/ comments but keeps string/template contents and line structure (comments become spaces,
 * newlines stay) so reported line numbers remain right. Heuristic: regex literals containing quotes can fool it.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (q !== "`" && src[i] === "\n") break; // unterminated: bail out of the string
        out += src[i];
        i++;
      }
      out += q;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** `file:line  text` lines for every regex match (regex must be global). */
export function findAll(rel: string, code: string, re: RegExp): string[] {
  const hits: string[] = [];
  for (const m of code.matchAll(re)) hits.push(`${rel}:${lineOf(code, m.index ?? 0)}  ${m[0].replace(/\s+/g, " ").slice(0, 80)}`);
  return hits;
}
