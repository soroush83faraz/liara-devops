/**
 * Minimal gitignore-style matcher for `.liaraignore` / `.dockerignore` /
 * `.gitignore`. Supports `#`, `!`, leading `/`, trailing `/`, `*`, `?`, `**`.
 * Approximation of the `ignore` package the CLI uses (no character classes).
 */
interface Rule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function toRegex(glob: string, anchored: boolean): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${re}$`);
}

export function parseIgnore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.startsWith("/") || line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;
    rules.push({ re: toRegex(line, anchored), negate, dirOnly });
  }
  return rules;
}

/** Returns a predicate: true when the (posix, relative) file path is ignored. */
export function createIgnore(...ruleSets: string[]): (path: string) => boolean {
  const rules = ruleSets.flatMap(parseIgnore);
  return (path) => {
    const parts = path.split("/");
    // A path is ignored if it or any parent directory is ignored (re-including below an ignored dir is not possible).
    for (let i = 1; i <= parts.length; i++) {
      const isDir = i < parts.length;
      const sub = parts.slice(0, i).join("/");
      let ignored = false;
      for (const r of rules) {
        if (r.dirOnly && !isDir) continue;
        if (r.re.test(sub)) ignored = !r.negate;
      }
      if (ignored) return true;
    }
    return false;
  };
}

/** [CLI] utils/create-archive.ts defaultIgnores */
export const DEFAULT_IGNORES = [
  ".git", ".idea", ".vscode", ".next", ".dockerignore", "*.*~", "liara.json", "node_modules", "bower_components", ".DS_Store",
].join("\n");
