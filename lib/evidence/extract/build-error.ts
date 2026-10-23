// build-error: dependency/build failures in build output (and missing modules at runtime). Independent of the
// stream: npm prints its errors on STDOUT (live 2026-10-23), the final Docker step line arrives on STDERR.
import { combineOccurrences, mergeOccurrence, occurrenceParams, type Occurrence } from "../lines";
import { draft, SIG } from "../observe";
import type { DraftObservation, EvidenceLine, ExtractContext, LogGroup } from "../types";

interface BuildHit {
  rule: string;
  detail?: string;
}

/** Structured facts derived from a hit: the npm/pip error code, the package and the requested version range. */
export interface BuildFacts {
  code?: string;
  package?: string;
  range?: string;
}

const PKG = String.raw`(?:@[\w.-]{1,100}\/)?[\w.-]{1,200}`;

// Ordered from most to least specific; the first match names the line.
const RULES: Array<{ rule: string; re: RegExp }> = [
  { rule: "missing_module", re: new RegExp(String.raw`Cannot find module '(?<d>[^']{1,200})'`) },
  { rule: "missing_module", re: new RegExp(String.raw`Module not found: (?:Error: )?Can't resolve '(?<d>[^']{1,200})'`) },
  { rule: "missing_module", re: new RegExp(String.raw`ModuleNotFoundError: No module named '(?<d>[^']{1,200})'`) },
  { rule: "missing_module", re: new RegExp(String.raw`ImportError: (?:cannot import name|No module named) '?(?<d>[\w.]{1,200})'?`) },
  // "npm error notarget No matching version found for express@^99.0.0." (npm >= 10) / "npm ERR! notarget ..." (legacy)
  { rule: "npm_no_matching_version", re: new RegExp(String.raw`npm (?:ERR!|error) notarget No matching version found for (?<d>${PKG}@\S{1,100}?)\.?\s*$`) },
  { rule: "npm_not_found", re: new RegExp(String.raw`npm (?:ERR!|error) 404\s+'?(?<d>[^'\s]{1,200})'? is not in (?:this|the npm) registry`) },
  { rule: "npm_eresolve", re: /npm (?:ERR!|error) (?:code )?ERESOLVE/ },
  { rule: "npm_error", re: new RegExp(String.raw`npm (?:ERR!|error) code (?<d>E[A-Z0-9_]{2,40})`) },
  { rule: "npm_error", re: new RegExp(String.raw`npm (?:ERR!|error) (?:Missing script|missing script):? "?(?<d>[\w:-]{1,60})"?`) },
  { rule: "pnpm_error", re: new RegExp(String.raw`\bERR_PNPM_(?<d>[A-Z0-9_]{2,60})`) },
  { rule: "yarn_error", re: new RegExp(String.raw`^error (?:An unexpected error occurred|Couldn't find package "(?<d>[^"]{1,200})")`) },
  { rule: "pip_no_version", re: new RegExp(String.raw`Could not find a version that satisfies the requirement (?<d>\S{1,200})`) },
  { rule: "pip_no_distribution", re: new RegExp(String.raw`No matching distribution found for (?<d>\S{1,200})`) },
  { rule: "pip_resolution", re: /ResolutionImpossible|pip's dependency resolver|subprocess-exited-with-error/ },
  { rule: "composer_requires", re: new RegExp(String.raw`requires (?<d>[\w.-]{1,100}\/[\w.-]{1,100} \S{1,60}), found`) },
  { rule: "composer_unresolvable", re: /Your requirements could not be resolved to an installable set of packages/ },
  { rule: "composer_script", re: new RegExp(String.raw`Script (?<d>.{1,120}?) handling the .{1,60} event returned with error code \d+`) },
  { rule: "docker_step_failed", re: new RegExp(String.raw`The command '(?<d>.{1,200})' returned a non-zero code: \d+`) },
  { rule: "docker_step_failed", re: new RegExp(String.raw`failed to solve:? (?<d>.{1,200})`) },
  { rule: "docker_step_failed", re: new RegExp(String.raw`ERROR \[[^\]]{1,40}\] (?<d>RUN .{1,200})`) },
  { rule: "compile_error", re: /\b(?:Failed to compile|Type error:|error TS\d{3,5}:|SyntaxError:)/ },
  { rule: "build_script_failed", re: /\b(?:Build failed|build failed|exited with code [1-9]\d*|ELIFECYCLE)\b/ },
];

/** Rules that only say "a step failed": never the cause when a specific error was found. */
export const GENERIC_BUILD_RULES: ReadonlySet<string> = new Set(["docker_step_failed", "build_script_failed"]);
const NPM_RULES = new Set(["npm_no_matching_version", "npm_not_found", "npm_eresolve", "npm_error"]);
/** npm's own error lines; the log-path footer and bare prefixes carry no information. */
const NPM_LINE = /^\s*npm (?:ERR!|error)\b/;
const NPM_NOISE = /^\s*npm (?:ERR!|error)\s*(?:A complete log of this run can be found in|$)/;

export function parseBuildError(message: string): BuildHit | undefined {
  for (const { rule, re } of RULES) {
    const m = re.exec(message);
    if (m) return { rule, ...(m.groups?.d ? { detail: m.groups.d.trim() } : {}) };
  }
  return undefined;
}

/** `name@range` -> parts (a leading `@` is a scope, not the separator). */
function splitAt(spec: string): { package?: string; range?: string } {
  const i = spec.lastIndexOf("@");
  return i > 0 ? { package: spec.slice(0, i), range: spec.slice(i + 1) } : { package: spec };
}

/** Code, package and version range implied by a hit (empty for hits that carry none). */
export function buildFacts(hit: BuildHit): BuildFacts {
  const d = hit.detail;
  switch (hit.rule) {
    case "npm_no_matching_version":
      return { code: "ETARGET", ...(d ? splitAt(d) : {}) };
    case "npm_not_found":
      return { code: "E404", ...(d ? splitAt(d) : {}) };
    case "npm_eresolve":
      return { code: "ERESOLVE" };
    case "npm_error":
      return d && /^E[A-Z0-9_]+$/.test(d) ? { code: d } : {};
    case "pnpm_error":
      return d ? { code: `ERR_PNPM_${d}` } : {};
    case "missing_module":
    case "yarn_error":
      return d ? { package: d } : {};
    case "pip_no_version":
    case "pip_no_distribution": {
      const m = d ? /^(?<p>[A-Za-z0-9_.\-[\]]+?)(?<r>(?:===|==|>=|<=|~=|!=|>|<).*)?$/.exec(d) : null;
      return m?.groups ? { package: m.groups.p, ...(m.groups.r ? { range: m.groups.r } : {}) } : {};
    }
    case "composer_requires": {
      const [p, r] = (d ?? "").split(" ");
      return { ...(p ? { package: p } : {}), ...(r ? { range: r } : {}) };
    }
    default:
      return {};
  }
}

function scan(groups: readonly LogGroup[], onlyModules: boolean) {
  const map = new Map<string, { hit: BuildHit; occ: Occurrence }>();
  for (const g of groups) {
    const hit = parseBuildError(g.message);
    if (!hit || (onlyModules && hit.rule !== "missing_module")) continue;
    const id = `${hit.rule}|${hit.detail ?? ""}`;
    const prev = map.get(id);
    map.set(id, { hit: prev?.hit ?? hit, occ: mergeOccurrence(prev?.occ, g) });
  }
  return [...map.values()];
}

/** The first `n` informative npm error lines in output order (the excerpt of the npm observation). */
function npmExcerpt(lines: readonly EvidenceLine[], n = 3): string {
  return lines
    .filter((l) => NPM_LINE.test(l.message) && !NPM_NOISE.test(l.message))
    .slice(0, n)
    .map((l) => l.message.trim())
    .join("\n");
}

/** Merges every npm hit of one build into a single observation: code + package + range, the most specific rule. */
function npmObservation(hits: ReadonlyArray<{ hit: BuildHit; occ: Occurrence }>, ctx: ExtractContext, releaseTag: string | undefined): DraftObservation {
  const order = ["npm_no_matching_version", "npm_not_found", "npm_eresolve", "npm_error"];
  const sorted = [...hits].sort((a, b) => order.indexOf(a.hit.rule) - order.indexOf(b.hit.rule));
  const facts: BuildFacts = {};
  for (const { hit } of sorted) {
    const f = buildFacts(hit);
    facts.code ??= f.code;
    facts.package ??= f.package;
    facts.range ??= f.range;
  }
  // An explicit "npm error code X" line wins over the code implied by a message.
  const explicit = hits.map(({ hit }) => (hit.rule === "npm_error" ? buildFacts(hit).code : undefined)).find(Boolean);
  if (explicit) facts.code = explicit;
  let occ = hits[0].occ;
  for (const h of hits.slice(1)) occ = combineOccurrences(occ, h.occ);
  const rule = sorted[0].hit.rule;
  const text = npmExcerpt(ctx.buildLines) || sorted[0].occ.sample;
  const detail = facts.package ? `${facts.package}${facts.range ? `@${facts.range}` : ""}` : (facts.code ?? sorted[0].hit.detail);
  return draft("build_error", "liara:build-logs", `evidence.build.${rule}`, "error", text, {
    rule, code: facts.code, package: facts.package, range: facts.range, detail, releaseTag, ...occurrenceParams(occ), [SIG]: true,
  }, occ.firstTs);
}

const FAILED_STATES = /^(?:FAILED|TIMEDOUT|CANCELED|CANCELLED|UNHEALTHY)$/i;

export function extractBuildError(ctx: ExtractContext): DraftObservation[] {
  const out: DraftObservation[] = [];
  const newest = ctx.releases[0];
  const failed = FAILED_STATES.test(newest?.state ?? "");

  if (newest?.failReason) {
    out.push(
      draft("build_error", "liara:releases", "evidence.build.fail_reason", "error", newest.failReason, {
        rule: "fail_reason", failReason: newest.failReason, releaseTag: newest.tag, releaseId: newest.id, [SIG]: true,
      }, newest.finishedAt ?? newest.createdAt),
    );
  }

  const known = scan(ctx.buildGroups, false);
  const npm = known.filter((k) => NPM_RULES.has(k.hit.rule));
  const others = known.filter((k) => !NPM_RULES.has(k.hit.rule));
  const specific = npm.length > 0 || others.some((k) => !GENERIC_BUILD_RULES.has(k.hit.rule));
  if (npm.length) out.push(npmObservation(npm, ctx, newest?.tag));
  for (const { hit, occ } of others) {
    // "The command ... returned a non-zero code" only restates that a step failed: context, not the cause.
    const generic = GENERIC_BUILD_RULES.has(hit.rule) && specific;
    const f = buildFacts(hit);
    out.push(
      draft("build_error", "liara:build-logs", `evidence.build.${hit.rule}`, generic ? "info" : "error", occ.sample, {
        rule: hit.rule, detail: hit.detail, code: f.code, package: f.package, range: f.range, generic: generic || undefined, releaseTag: newest?.tag, ...occurrenceParams(occ), [SIG]: !generic,
      }, occ.firstTs),
    );
  }

  // Unrecognised STDERR output only matters when the build actually failed.
  if (failed && known.length === 0) {
    const stderr = ctx.buildGroups.filter((g) => g.stream === "stderr" && !/\b(?:WARN|warning|notice|deprecated)\b/i.test(g.message));
    for (const g of stderr.slice(-3)) {
      const occ = mergeOccurrence(undefined, g);
      out.push(
        draft("build_error", "liara:build-logs", "evidence.build.stderr", "warn", occ.sample, {
          rule: "stderr", releaseTag: newest?.tag, ...occurrenceParams(occ), [SIG]: false,
        }, occ.firstTs),
      );
    }
  }

  for (const { hit, occ } of scan(ctx.logGroups, true)) {
    out.push(
      draft("build_error", "liara:logs", "evidence.build.runtime_missing_module", "error", occ.sample, {
        rule: hit.rule, detail: hit.detail, package: hit.detail, ...occurrenceParams(occ), [SIG]: true,
      }, occ.firstTs),
    );
  }
  return out;
}
