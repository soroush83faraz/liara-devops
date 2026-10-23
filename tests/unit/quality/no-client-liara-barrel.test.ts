// Guard: the browser bundle must never reach the `@/lib/liara` barrel (it re-exports Node-only modules such as
// ./deploy, which imports node:stream/promises; Turbopack panicked on it in dev). For every `"use client"` file and
// every module it imports transitively (components/, lib/, app/), a VALUE import of the barrel, or a deep import of a
// Node-only liara module, fails the build. `import type` is erased by the compiler and is fine. Deep imports of pure
// modules (account, schemas, ...) are fine. The Node-only list is computed from each module's own imports.
import { existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { findAll, listFiles, read, stripComments } from "./scan";

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const isNodeBuiltin = (spec: string) => spec.startsWith("node:") || BUILTINS.has(spec) || BUILTINS.has(spec.split("/")[0]);

interface Import {
  spec: string;
  line: number;
}

/** Value imports only: `import type ...` and `import { type A }` (all specifiers type-only) are erased by TypeScript. */
export function valueImports(rel: string): Import[] {
  const code = stripComments(read(rel));
  const out: Import[] = [];
  const add = (spec: string, index: number) => out.push({ spec, line: code.slice(0, index).split("\n").length });
  const staticRe = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?([^"'`;]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(staticRe)) {
    if (m[2]) continue; // import type / export type
    const clause = m[3].trim();
    const named = /^\{([\s\S]*)\}$/.exec(clause);
    if (named) {
      const parts = named[1].split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((p) => /^type\s/.test(p))) continue;
    }
    add(m[4], (m.index ?? 0) + m[0].search(/import|export/));
  }
  for (const m of code.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g)) add(m[1], (m.index ?? 0) + m[0].search(/import/)); // side-effect imports
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) add(m[1], m.index ?? 0); // dynamic imports
  return out;
}

const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Repo-relative path of a local import, or null for packages and unresolvable specifiers. */
export function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  for (const c of CANDIDATES) {
    const p = base + c;
    if (/\.(ts|tsx)$/.test(p) && existsSync(join(__dirname, "..", "..", "..", p))) return p;
  }
  return null;
}

const isClient = (rel: string) => /^\s*["']use client["']/.test(stripComments(read(rel)).trimStart());
const isServerOnly = (rel: string) => valueImports(rel).some((i) => i.spec === "server-only");

/** Does this module reach a Node built-in (directly or through local value imports)? */
function reachesNode(rel: string, memo = new Map<string, boolean>(), stack = new Set<string>()): boolean {
  const known = memo.get(rel);
  if (known !== undefined) return known;
  if (stack.has(rel)) return false;
  stack.add(rel);
  let hit = false;
  for (const i of valueImports(rel)) {
    if (isNodeBuiltin(i.spec)) hit = true;
    else {
      const dep = resolveLocal(rel, i.spec);
      if (dep && reachesNode(dep, memo, stack)) hit = true;
    }
    if (hit) break;
  }
  stack.delete(rel);
  memo.set(rel, hit);
  return hit;
}

const BARREL = "lib/liara/index.ts";

/** Computed, not hand-written: every lib/liara module (except the barrel) that reaches a Node built-in. */
export function nodeOnlyLiaraModules(): string[] {
  const memo = new Map<string, boolean>();
  return listFiles(["lib/liara"], [".ts"]).filter((f) => f !== BARREL && reachesNode(f, memo));
}

export function clientOffenders(): string[] {
  const nodeOnly = new Set(nodeOnlyLiaraModules());
  const roots = listFiles(["app", "components", "lib"], [".ts", ".tsx"]).filter(isClient);
  const seen = new Set<string>();
  const queue = [...roots];
  const offenders: string[] = [];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (isServerOnly(file)) continue;
    for (const imp of valueImports(file)) {
      const dep = resolveLocal(file, imp.spec);
      if (!dep) continue;
      if (dep === BARREL) offenders.push(`${file}:${imp.line}  imports the liara barrel (${imp.spec}); import a pure module directly`);
      else if (nodeOnly.has(dep)) offenders.push(`${file}:${imp.line}  imports Node-only ${dep}`);
      else queue.push(dep);
    }
  }
  return offenders.sort();
}

describe("client bundle never reaches the liara barrel or its Node-only modules", () => {
  it("the import scanner understands the forms it must (type-only imports are erased)", () => {
    // Self-check on a real file that mixes both forms.
    const imports = valueImports("components/setup/wizard.tsx");
    expect(imports.some((i) => i.spec === "@/lib/setup/client")).toBe(true);
    expect(imports.some((i) => i.spec === "@/lib/setup/api-types")).toBe(false); // import type
    expect(resolveLocal("components/setup/wizard.tsx", "./review-step")).toBe("components/setup/review-step.tsx");
    expect(resolveLocal("components/setup/wizard.tsx", "@/lib/liara")).toBe(BARREL);
  });

  it("computes the Node-only liara modules (deploy streams a tarball; the pure account/schemas modules are fine)", () => {
    const nodeOnly = nodeOnlyLiaraModules();
    expect(nodeOnly).toContain("lib/liara/deploy.ts");
    expect(nodeOnly).not.toContain("lib/liara/schemas.ts");
    expect(nodeOnly).not.toContain("lib/liara/account.ts");
  });

  it("finds client roots", () => {
    const roots = listFiles(["app", "components", "lib"], [".ts", ".tsx"]).filter(isClient);
    expect(roots.length).toBeGreaterThan(50);
    expect(roots).toContain("components/setup/wizard.tsx");
  });

  it("no client module imports the barrel or a Node-only liara module", () => {
    expect(clientOffenders(), "Client code must import pure liara modules (e.g. @/lib/liara/account), never the barrel:").toEqual([]);
  });

  it("detects a barrel import (guard against the guard silently passing)", () => {
    const hits = findAll("x.ts", stripComments(`import { getMe } from "@/lib/liara";\nimport type { A } from "@/lib/liara";`), /from\s*["']@\/lib\/liara["']/g);
    expect(hits).toHaveLength(2);
  });
});
