// Pure, deterministic project detector over a ProjectFiles view. No I/O, no execution, no LLM: file contents are
// treated as untrusted data and only matched with bounded regexes / JSON.parse. Env VALUES never reach this layer
// (see files.ts transformFile); only names and coarse engine hints do.
import { PLATFORMS, type DbEngine, type Platform } from "@/lib/contracts";
import { Dir, addDb, newFinding, obj, str, type Finding } from "./detectors/common";
import { detectDocker, detectStatic } from "./detectors/docker";
import { detectDotnet } from "./detectors/dotnet";
import { detectGo } from "./detectors/go";
import { detectNode } from "./detectors/node";
import { detectPhp } from "./detectors/php";
import { detectPython } from "./detectors/python";
import { ENV_NAME_RE, PLATFORM_ENV_NAMES, envNamesFromReadme, looksSecret, parseSanitizedEnv, uniqueNames } from "./env-names";
import { isEnvFile, isRealEnvFile } from "./files";
import { LARGE_PROJECT_BYTES } from "./limits";
import type { DbNeed, PortSource, ProjectAnalysis, ProjectFiles, Reason } from "./types";

export { wantsFile, transformFile } from "./files";

const SPA_PLATFORMS: ReadonlySet<Platform> = new Set(["static", "react", "vue", "angular"]);
const MANIFEST_BASENAMES = new Set(["package.json", "composer.json", "requirements.txt", "pyproject.toml", "Pipfile", "go.mod", "Dockerfile", "manage.py"]);
const NOT_PROJECT_DIRS = new Set(["docs", "doc", "test", "tests", "__tests__", "examples", "example", "scripts", "e2e", ".github", "samples", "fixtures"]);
const ENGINE_ORDER: DbEngine[] = ["postgres", "mysql", "mariadb", "mssql", "mongodb", "redis", "elasticsearch", "rabbitmq", "clickhouse"];

function monorepoCandidates(paths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    if (parts.length < 2 || parts.length > 3) continue;
    const base = parts[parts.length - 1];
    if (!(MANIFEST_BASENAMES.has(base) || /\.(cs|fs)proj$/.test(base))) continue;
    const dir = parts.slice(0, -1);
    if (dir.some((s) => NOT_PROJECT_DIRS.has(s))) continue;
    dirs.add(dir.join("/"));
  }
  return [...dirs].sort().slice(0, 20);
}

function readLiaraJson(d: Dir): ProjectAnalysis["liaraJson"] {
  const json = d.json("liara.json");
  if (!json) return undefined;
  const platform = typeof json.platform === "string" && (PLATFORMS as readonly string[]).includes(json.platform) ? (json.platform as Platform) : undefined;
  const port = typeof json.port === "number" && Number.isInteger(json.port) && json.port >= 1 && json.port <= 65535 ? json.port : undefined;
  const envs = json.envs ?? json.env ?? json.environment;
  let names: string[] = [];
  if (Array.isArray(envs)) names = envs.map((e) => (typeof e === "string" ? e : str(obj(e).key) ?? ""));
  else if (envs && typeof envs === "object") names = Object.keys(envs);
  const app = str(json.app, 80);
  return { platform, port, app: app && /^[a-z0-9-]+$/.test(app) ? app : undefined, envNames: uniqueNames(names) };
}

function collectEnv(files: ProjectFiles, d: Dir, paths: readonly string[]): { names: string[]; engines: Array<{ engine: DbEngine; file: string }>; realEnvFile: boolean } {
  const names: string[][] = [];
  const engines: Array<{ engine: DbEngine; file: string }> = [];
  let realEnvFile = false;
  for (const p of paths) {
    const parts = p.split("/");
    const base = parts[parts.length - 1];
    if (parts.length > 3 || !isEnvFile(base)) continue;
    if (d.dir && !p.startsWith(`${d.dir}/`)) continue;
    if (isRealEnvFile(p)) realEnvFile = true;
    const text = files.read(p);
    if (text === undefined) continue;
    const parsed = parseSanitizedEnv(text);
    names.push(parsed.names);
    for (const e of parsed.engineHints) engines.push({ engine: e, file: base });
  }
  const readme = [d.read("README.md"), d.read("readme.md"), d.read("README"), d.read("README.txt")].find((t) => t !== undefined);
  if (readme) names.push(envNamesFromReadme(readme));
  return { names: uniqueNames(...names), engines, realEnvFile };
}

function dbFromEnvNames(names: readonly string[], platform: Platform, f: { db: DbNeed[] }): void {
  const has = (re: RegExp) => names.find((n) => re.test(n));
  let hit: string | undefined;
  if ((hit = has(/^(POSTGRES(QL)?|PG)(_|$)/))) addDb(f, "postgres", `env example: ${hit}`);
  if ((hit = has(/^MYSQL_/))) addDb(f, "mysql", `env example: ${hit}`);
  if ((hit = has(/^MARIADB_/))) addDb(f, "mariadb", `env example: ${hit}`);
  if ((hit = has(/^(MONGO(DB)?)(_|$)/))) addDb(f, "mongodb", `env example: ${hit}`);
  if ((hit = has(/^REDIS(_|$)/))) addDb(f, "redis", `env example: ${hit}`);
  if (platform === "laravel" && f.db.every((x) => x.engine === "redis") && (has(/^DB_(HOST|DATABASE)$/))) {
    addDb(f, "mysql", "env example: DB_* (Laravel default is MySQL)");
  }
}

function mergeUnique<T>(into: T[], from: readonly T[], key: (t: T) => string): void {
  const seen = new Set(into.map(key));
  for (const t of from) if (!seen.has(key(t))) into.push(t);
}

function emptyAnalysis(files: ProjectFiles, candidates: string[], warnings: string[]): ProjectAnalysis {
  return {
    platform: "unknown",
    confidence: 0,
    reasons: [{ code: candidates.length > 1 ? "monorepo_ambiguous" : "nothing_recognised" }],
    candidates: [],
    staticSite: false,
    hasDockerfile: false,
    requiresDatabase: [],
    envVarNames: [],
    secretsLikely: [],
    resourceHints: [],
    warnings,
    monorepoCandidates: candidates,
    stats: { fileCount: files.paths.length, totalBytes: files.totalBytes },
  };
}

export function analyzeProject(files: ProjectFiles): ProjectAnalysis {
  const pathSet = new Set(files.paths);
  const candidates = monorepoCandidates(files.paths);
  let d = new Dir(files, "", pathSet);
  const warnings: string[] = [];
  if (files.skippedLarge) warnings.push("skipped_large_files");

  const run = (dir: Dir): Finding[] =>
    [detectDocker(dir), detectNode(dir), detectPython(dir), detectPhp(dir), detectGo(dir), detectDotnet(dir)].filter((x): x is Finding => x !== undefined);
  let findings = run(d);
  const rootStatic = detectStatic(d);

  if (findings.length === 0 && !rootStatic) {
    if (candidates.length === 1) {
      d = new Dir(files, candidates[0], pathSet);
      findings = run(d);
      if (findings.length > 0) warnings.push("not_at_root");
    }
    if (findings.length === 0) {
      return emptyAnalysis(files, candidates, [...warnings, candidates.length > 1 ? "monorepo" : "unknown_platform", "no_dependency_manifest"]);
    }
  }
  if (findings.length === 0 && rootStatic) findings = [rootStatic];

  const liara = readLiaraJson(d);
  const reasons: Reason[] = [];
  const ranked = [...findings].sort((a, b) => b.score - a.score);
  let winner = ranked[0];
  if (liara?.platform) {
    const matching = ranked.find((f) => f.platform === liara.platform);
    winner = matching ? { ...matching, score: 0.99 } : { ...newFinding(liara.platform, 0.99), db: [], reasons: [] };
    reasons.push({ code: "liara_json_platform", file: "liara.json", detail: liara.platform });
  }
  const hasDockerfile = d.has("Dockerfile");

  reasons.push(...winner.reasons);
  const others = ranked.filter((f) => f !== winner && f.platform !== winner.platform);
  if (winner.platform === "docker") {
    const fw = others.find((f) => f.framework);
    if (fw) {
      winner.framework = fw.framework;
      reasons.push({ code: "dockerfile_overrides_framework", file: "Dockerfile", detail: fw.framework });
      warnings.push("dockerfile_and_framework");
    }
  } else if (hasDockerfile) {
    reasons.push({ code: "dockerfile_also_present", file: "Dockerfile" });
  }

  // Facts that describe the project as a whole are unioned across findings; warnings come from the winner only.
  const db: DbNeed[] = [];
  const envNames: string[][] = [];
  const resourceHints: string[] = [];
  const warn = new Set<string>([...warnings, ...winner.warnings]);
  for (const f of ranked) {
    mergeUnique(db, f.db, (x) => x.engine);
    envNames.push(f.envNames);
    for (const h of f.resourceHints) if (!resourceHints.includes(h)) resourceHints.push(h);
  }

  const env = collectEnv(files, d, files.paths);
  if (env.realEnvFile) warn.add("env_file_in_archive");
  envNames.push(env.names, liara?.envNames ?? []);
  const allNames = uniqueNames(...envNames).filter((n) => ENV_NAME_RE.test(n) && !PLATFORM_ENV_NAMES.has(n));
  const dbHolder = { db };
  for (const e of env.engines) addDb(dbHolder, e.engine, `${e.file}: ${e.engine}`);
  dbFromEnvNames(allNames, winner.platform, dbHolder);
  db.sort((a, b) => ENGINE_ORDER.indexOf(a.engine) - ENGINE_ORDER.indexOf(b.engine));
  if (db.length >= 3) warn.add("many_databases");
  if (files.totalBytes > LARGE_PROJECT_BYTES) warn.add("large_size");

  // Port: liara.json > code/script/config > Dockerfile EXPOSE.
  let port: { value: number; source: PortSource } | undefined;
  if (liara?.port) port = { value: liara.port, source: "liara_json" };
  else if (winner.port) port = winner.port;
  else {
    const dock = findings.find((f) => f.platform === "docker")?.port;
    if (dock) port = dock;
  }

  const platform = winner.platform;
  const staticSite = SPA_PLATFORMS.has(platform) && (winner.staticSite ?? platform !== "docker");
  if (platform === "docker" && !hasDockerfile) warn.add("docker_without_dockerfile");

  const top = ranked[0].score;
  const second = ranked.find((f) => f.platform !== ranked[0].platform && ranked[0].platform !== "docker" && f.platform !== "docker");
  let confidence = Math.min(1, winner.score);
  if (second && top - second.score < 0.1 && !liara?.platform) {
    warn.add("ambiguous_platform");
    confidence = Math.max(0.2, confidence - 0.2);
  }
  if (candidates.length >= 2 && !winner.framework) warn.add("monorepo");

  return {
    platform,
    confidence: Math.round(confidence * 100) / 100,
    reasons: reasons.slice(0, 40),
    candidates: ranked.map((f) => ({ platform: f.platform, score: f.score })).slice(0, 14),
    framework: winner.framework,
    nodeVersion: winner.nodeVersion,
    pythonVersion: winner.pythonVersion,
    packageManager: winner.packageManager,
    startCommand: winner.startCommand,
    buildCommand: winner.buildCommand,
    port: port?.value,
    portSource: port?.source,
    staticSite,
    hasDockerfile,
    requiresDatabase: db,
    envVarNames: allNames,
    secretsLikely: allNames.filter(looksSecret),
    resourceHints,
    warnings: [...warn],
    monorepoCandidates: candidates,
    liaraJson: liara,
    stats: { fileCount: files.paths.length, totalBytes: files.totalBytes },
  };
}
