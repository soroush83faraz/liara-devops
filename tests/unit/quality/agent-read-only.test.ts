// Guard: the AI agent has no mutation path. lib/agent may read Liara and PROPOSE actions, but must not import a
// function that changes Liara state, the executors that run approved proposals, or issue write requests itself.
import { describe, expect, it } from "vitest";
import { listFiles, read, stripComments } from "./scan";

/** Always-forbidden names, independent of the auto-detection below (defence if detection ever breaks). */
const KNOWN_MUTATORS = [
  "createApp", "deleteApp", "restartApp", "scaleApp", "startApp", "stopApp", "resizeApp", "updateAppPort", "setAppToggle",
  "updateEnvs", "applyEnvOps", "createDatabase", "deleteDatabase", "createNetwork", "createDomain", "addDomain", "deleteDomain",
  "provisionSsl", "createDisk", "deleteDisk", "resizeDisk", "cancelRelease", "createRelease", "uploadSource", "deployApp",
];

/** Modules that execute approved proposals or write: the agent must never import them. */
const FORBIDDEN_MODULES = [/lib\/actions\/exec/, /lib\/actions\/executors/, /lib\/actions\/mutate/, /lib\/actions\/run\b/, /lib\/server\/user-op/, /lib\/actions\/index/];

/** Exported function names in lib/liara/*.ts whose body issues a non-GET request (directly or via another mutator). */
function detectMutators(): Set<string> {
  const bodies = new Map<string, string>();
  for (const f of listFiles(["lib/liara"], [".ts"])) {
    const code = stripComments(read(f));
    const re = /export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/g;
    const starts: Array<{ name: string; at: number }> = [];
    for (const m of code.matchAll(re)) starts.push({ name: m[1] ?? m[2], at: m.index ?? 0 });
    starts.forEach((s, i) => bodies.set(s.name, code.slice(s.at, starts[i + 1]?.at ?? code.length)));
  }
  const mutators = new Set<string>(KNOWN_MUTATORS.filter((n) => bodies.has(n)));
  for (const [name, body] of bodies) if (/\.(post|patch|put|delete)\s*[(<]/.test(body) && !/^(get|list|check|fetch|parse)/.test(name)) mutators.add(name);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of bodies) {
      if (mutators.has(name)) continue;
      for (const m of mutators) if (new RegExp(`\\b${m}\\s*\\(`).test(body)) {
        mutators.add(name);
        changed = true;
        break;
      }
    }
  }
  return mutators;
}

function importedNames(code: string): Array<{ from: string; names: string[] }> {
  const out: Array<{ from: string; names: string[] }> = [];
  for (const m of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    out.push({ from: m[2], names: m[1].split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean) });
  }
  return out;
}

describe("the agent cannot mutate Liara", () => {
  const mutators = detectMutators();
  const agentFiles = listFiles(["lib/agent"], [".ts", ".tsx"]);

  it("detects the known mutating functions of the Liara client (sanity)", () => {
    for (const n of ["restartApp", "updateEnvs", "createApp", "deleteApp", "startApp", "applyEnvOps"]) expect(mutators.has(n), n).toBe(true);
    for (const n of ["listApps", "getApp", "getRuntimeLogs", "getBilling"]) expect(mutators.has(n), `${n} is read-only`).toBe(false);
    expect(agentFiles.length).toBeGreaterThan(15);
  });

  it("no lib/agent file imports a mutating Liara function", () => {
    const hits: string[] = [];
    for (const f of agentFiles) {
      for (const imp of importedNames(stripComments(read(f)))) {
        if (!/(^|\/)liara(\/|$)|\.\.\/liara/.test(imp.from)) continue;
        for (const n of imp.names) if (mutators.has(n)) hits.push(`${f}  imports ${n} from ${imp.from}`);
      }
    }
    expect(hits, "The agent may only call read functions; mutations go through a proposal + approval + executor:").toEqual([]);
  });

  it("no lib/agent file imports an executor/mutation module", () => {
    const hits = agentFiles.flatMap((f) =>
      importedNames(stripComments(read(f))).filter((i) => FORBIDDEN_MODULES.some((re) => re.test(i.from))).map((i) => `${f}  imports ${i.from}`),
    );
    expect(hits).toEqual([]);
  });

  it("no lib/agent file issues write requests on a Liara client", () => {
    const hits = agentFiles.flatMap((f) => {
      const code = stripComments(read(f));
      return [...code.matchAll(/\b(?:liara|client)\s*\.\s*(post|patch|put|delete)\s*\(/g)].map((m) => `${f}  ${m[0]}`);
    });
    expect(hits).toEqual([]);
  });

  it("the agent pipeline is handed the read-only client wrapper", () => {
    const handler = stripComments(read("lib/agent/orchestrate.ts"));
    expect(handler, "runAgent must wrap deps.liara with readOnlyLiara() before any tool sees it").toMatch(/readOnlyLiara\s*\(\s*deps\.liara\s*\)/);
  });
});
