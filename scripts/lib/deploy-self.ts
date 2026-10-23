/*
 * deploy-self: deploys THIS repository (the Hamyar Liara product) to Liara through the product's own code path:
 * lib/actions executors (billed-create guard, plan price check, team-aware balance check, typed deletes) and
 * lib/liara/deploy.ts (createSourceArchive, uploadSource, createRelease, watchRelease). It is a live test of that
 * path as much as a deploy tool. DRY RUN by default (GET requests only); `--yes` acts; `--destroy --yes
 * --confirm-name <app>` removes everything it created. Mutations are sent once and never retried.
 *
 * Liara behaviour, checked live 2026-10-23 unless marked [VAL] (= still NOT verified live: an endpoint shape, a semantic or a price):
 *  - disk create: POST /v1/projects/{app}/disks {name:"data", size:"1"} works by name (verified live 2026-10-23). A 4xx
 *    refusal is reported and the deploy continues WITHOUT a disk (data is then not persistent).
 *    Disk LISTING uses the project `_id`, not the name (live 2026-10-23: by name -> 500). Disk resize, backups and delete
 *    by id are [VAL] (assumed).
 *  - update-envs: POST /v1/projects/update-envs replaces the FULL list and restarts the app. Verified live 2026-10-23: it
 *    works before the first release and values read back in clear (the executor's readback relies on them).
 *  - release body for platform next: verified live 2026-10-23: {sourceID, port, type:"next", message, disks:[{name,mountTo}],
 *    platformConfig: liara.json's `next` block verbatim}. liara.json `healthCheck` is NOT sent [VAL] (the CLI's transform is
 *    unverified and the `curl` it calls may not exist in the image); /api/health is probed from outside instead.
 *  - cost: verified live 2026-10-23: a bundle's displayPrice (monthly) is additive to the plan's hourly price (bundle/720 per
 *    hour; e.g. plan 659.72 + basic 381.94 = 1041.66 toman/hour). The 1 GB disk is about 104.17 toman/hour (INFERRED live
 *    from the first-hour charge 1145.83 = 659.72 + 381.94 + 104.17; not a documented price) and is part of the estimate,
 *    the 6 h projection and the 3x balance gate.
 *  - g2 plans require a private network (403 g2_plan_unavailable without one; verified live 2026-10-23). Without --network
 *    the script reads GET /v1/networks: exactly one -> used; none -> REFUSED with the command to create one (or pass
 *    --create-network <name>, which creates it with --yes before the app; free, 201); several -> --network is required.
 *  - public URL: verified live 2026-10-23: https://<app>.liara.run when `defaultSubdomain` is not false, plus any custom
 *    domain from GET /v1/domains (the .iran.liara.run form does not exist).
 *  - DATA_DIR: [VAL] liara.json mounts disk `data` at `data` (relative); assumed to resolve against the app root, which is
 *    the server's working directory, so DATA_DIR=./data (the product's default). An absolute mountTo is used as is.
 *  - destroy: [VAL] deleting the app is assumed to remove its disks; disks are deleted first anyway (failure tolerated).
 *
 * `--release-only --yes` redeploys a fixed source to an app this script already created: it skips plan pricing, the
 * balance gate, create_app, disk creation and set_env, verifies the app exists, and only uploads, releases, watches,
 * probes and logs `release_only`. It still needs ALLOW_BILLED_LIVE_TESTS=1 (a release consumes build quota).
 * It REFUSES (exit 2) when the disk named `data` cannot be looked up or is missing, unless `--no-disk`; afterwards it
 * re-reads the disks and prints PASS/FAIL "disk mounted", and the final report reads the real app/disk/env state.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import {
  createDisk, createRelease, createSourceArchive, getAccountBilling, getApp, getBuildLogs, getMe, isLiaraError, listAppPlans, listDisks, listDomains, listNetworks,
  normalizeAccount, teamIdOf, uploadSource, watchRelease,
  type LiaraClient, type Me, type NormalizedBilling, type NormalizedPlan, type SourceArchive, type SourceFile, type WatchOptions,
} from "../../lib/liara";
import { createIgnore, DEFAULT_IGNORES } from "../../lib/liara/ignore";
import { executeAction, type ExecResult } from "../../lib/actions/executors";
import { isActionError } from "../../lib/actions/errors";
import { mutateOnce } from "../../lib/actions/mutate";
import { appPlans, assertPriced, choosePlan, type PlanChoice } from "../../lib/actions/plans";
import type { ActionParams } from "../../lib/contracts/action";
import { isSecretKey } from "../../lib/security/redact";
import { GuardError, parseFlags, UsageError } from "./args";
import { EXIT, hasToken, liaraFromEnv, type Env } from "./guards";
import { describeError, redactForOutput, redactLine } from "./output";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

export interface DeploySelfDeps {
  env: Env;
  io: Io;
  /** fetch for the Liara API (tests: FakeLiara.fetchImpl). */
  fetchImpl?: typeof fetch;
  /** fetch for the public health probe of the deployed app (default: global fetch). */
  probeFetch?: typeof fetch;
  /** Release watch timing (tests shrink it). The timeout is capped at WATCH_TIMEOUT_MS. */
  watch?: WatchOptions;
  probe?: { attempts?: number; intervalMs?: number; timeoutMs?: number };
  sleep?: (ms: number) => Promise<void>;
  repoRoot?: string;
  spendLogPath?: string;
  now?: () => number;
}

export const REPO_ROOT = join(__dirname, "..", "..");
export const DEFAULT_APP = "hamyar-liara";
export const DEFAULT_SPEND_CAP_TOMAN = 50_000;
export const PREFERRED_PLAN = "small-g2";
export const BUNDLE = "basic";
export const DISK_NAME = "data";
/** 1 GB: the size used live 2026-10-23 (accepted); unit GB per lib/liara/disks.ts. */
export const DISK_SIZE_GB = 1;
/** toman per hour per GB of disk: INFERRED live 2026-10-23 from the first-hour charge 1145.83 = 659.72 + 381.94 + 104.17 (not a Liara-documented price). */
export const DISK_HOURLY_TOMAN_PER_GB = 104.17;
export const PROJECTION_HOURS = 6;
/** Balance must cover this many times the projected cost before anything billed is created. */
export const BALANCE_FACTOR = 3;
export const WATCH_TIMEOUT_MS = 15 * 60_000;
/** STDERR build lines printed when a release ends FAILED. */
export const FAIL_TAIL_LINES = 15;
/** Always in the archive even if an ignore rule matches (Liara builds with `npm ci`; the CLI drops liara.json). */
export const FORCE_INCLUDE = ["liara.json", "package.json", "package-lock.json"] as const;
export const ENV_NAMES = ["APP_SESSION_KEY", "APP_APPROVAL_KEY", "TRUSTED_PROXY_HOPS", "DATA_DIR"] as const;

const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SEP = "-".repeat(64);
const SCRIPT = "npx tsx --env-file=.env scripts/deploy-self.ts";

export function usage(): string {
  return [
    `${SCRIPT} [--yes] [--network <name> | --create-network <name>]`,
    `${SCRIPT} --release-only [--yes] [--no-disk]`,
    `${SCRIPT} --destroy --confirm-name <app> [--yes]`,
    "",
    "  Deploys THIS repo to Liara through the product's own executors and deploy code (lib/actions, lib/liara/deploy.ts).",
    "  DRY RUN by default: GET requests only; prints account, balance, plan, cost (before anything billed), files, steps.",
    "  --yes       execute (BILLED): create app + disk, set env vars, upload, release, watch, probe /api/health",
    "  --network   pass an existing private network name to create_app (g2 plans require one: verified live 2026-10-23).",
    "              Without it the script reads GET /v1/networks: one network -> used; none -> refused (see --create-network); several -> pass --network",
    "  --create-network <name>  (with --yes) create this private network first (POST /v1/networks, free) when it does not exist, then use it",
    "  --release-only  redeploy to an EXISTING app: only upload + release + watch + probe (no create_app, disk, env, plan or",
    "              balance gating); the same secret scan applies; --yes still needs ALLOW_BILLED_LIVE_TESTS=1; no --network/--destroy",
    "  --no-disk   (with --release-only) release WITHOUT the persistent disk. Without this flag a release-only run REFUSES when the",
    "              disk named data cannot be looked up (by project _id) or is not found, because the app would lose its data on restart",
    "  --destroy   delete the app and its disk (typed confirm: --confirm-name must equal the app name)",
    "",
    "  Environment (process env only): LIARA_API_TOKEN, LIARA_TEAM_ID (team mode: the team wallet pays),",
    `  ALLOW_BILLED_LIVE_TESTS=1 (required for any mutation), APP_NAME (default ${DEFAULT_APP}), SPEND_CAP_TOMAN (default ${DEFAULT_SPEND_CAP_TOMAN}).`,
    "  Spend log: scratch/spend-log.jsonl (git-ignored). Exit codes: 0 ok, 1 usage, 2 refused by a guard, 3 Liara/deploy failure.",
  ].join("\n");
}

/* ------------------------------------------------------------------ config */

export interface Config {
  app: string;
  capToman: number;
  teamMode: boolean;
}

export function readConfig(env: Env): Config {
  const app = (env.APP_NAME ?? "").trim() || DEFAULT_APP;
  if (!APP_NAME_RE.test(app)) throw new UsageError("APP_NAME must be a DNS label: 1-63 chars, lowercase letters, digits and inner hyphens");
  const rawCap = (env.SPEND_CAP_TOMAN ?? "").trim();
  const capToman = rawCap === "" ? DEFAULT_SPEND_CAP_TOMAN : Number(rawCap);
  if (!Number.isFinite(capToman) || capToman <= 0) throw new UsageError("SPEND_CAP_TOMAN must be a positive number (toman)");
  return { app, capToman, teamMode: (env.LIARA_TEAM_ID ?? "").trim() !== "" };
}

export interface LiaraJson {
  app?: string;
  platform: string;
  port: number;
  disks: Array<{ name: string; mountTo: string }>;
  next?: Record<string, unknown>;
}

export function readLiaraJson(root: string): LiaraJson {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(root, "liara.json"), "utf8"));
  } catch {
    throw new UsageError("liara.json is missing or not valid JSON at the repo root");
  }
  const j = (raw ?? {}) as Record<string, unknown>;
  const platform = typeof j.platform === "string" ? j.platform : "";
  const port = typeof j.port === "number" ? j.port : NaN;
  if (platform !== "next") throw new UsageError(`liara.json platform must be "next" (found ${JSON.stringify(platform)})`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError("liara.json port must be an integer 1-65535");
  const disks = Array.isArray(j.disks)
    ? j.disks.flatMap((d) => (d && typeof d === "object" && typeof (d as { name?: unknown }).name === "string" && typeof (d as { mountTo?: unknown }).mountTo === "string" ? [d as { name: string; mountTo: string }] : []))
    : [];
  const next = j.next && typeof j.next === "object" && !Array.isArray(j.next) ? (j.next as Record<string, unknown>) : undefined;
  return { app: typeof j.app === "string" ? j.app : undefined, platform, port, disks, next };
}

/** DATA_DIR that matches the disk mount: a relative mountTo resolves against the app root (= server cwd) [VAL]. */
export function dataDirFor(mountTo: string): string {
  const m = mountTo.trim().replace(/\/+$/, "");
  if (m.startsWith("/")) return m;
  return `./${m.replace(/^\.\//, "")}`;
}

/* ------------------------------------------------------------------ source */

export interface CollectedSource {
  files: SourceFile[];
  totalBytes: number;
  ignoredCount: number;
  skippedSymlinks: string[];
}

/** Ignore predicate for the upload: CLI defaults (minus liara.json) + root .liaraignore; FORCE_INCLUDE always kept. */
export function uploadIgnore(liaraignoreText: string): (path: string) => boolean {
  const defaults = DEFAULT_IGNORES.split("\n").filter((l) => l.trim() !== "liara.json").join("\n");
  const ignored = createIgnore(defaults, liaraignoreText);
  return (p) => !(FORCE_INCLUDE as readonly string[]).includes(p) && ignored(p);
}

/** Walks the repo root and returns the files the archive will contain (symlinks are skipped and listed). */
export function collectSource(root: string): CollectedSource {
  let liaraignore = "";
  try {
    liaraignore = readFileSync(join(root, ".liaraignore"), "utf8");
  } catch {
    throw new GuardError(".liaraignore is missing at the repo root; refusing to upload without it");
  }
  const ignored = uploadIgnore(liaraignore);
  // A directory is skipped when a file directly inside it would be ignored because of the directory itself
  // (the probe basename is a NUL byte, which no real rule targets except match-everything globs).
  const dirIgnored = (rel: string) => ignored(`${rel}/\u0000`);
  const out: CollectedSource = { files: [], totalBytes: 0, ignoredCount: 0, skippedSymlinks: [] };
  const walk = (relDir: string) => {
    const abs = relDir ? join(root, relDir) : root;
    for (const name of readdirSync(abs).sort()) {
      const rel = relDir ? posix.join(relDir, name) : name;
      const st = lstatSync(join(abs, name));
      if (st.isSymbolicLink()) {
        if (!ignored(rel)) out.skippedSymlinks.push(rel);
        continue;
      }
      if (st.isDirectory()) {
        if (dirIgnored(rel)) out.ignoredCount++;
        else walk(rel);
        continue;
      }
      if (!st.isFile()) continue;
      if (ignored(rel)) {
        out.ignoredCount++;
        continue;
      }
      const data = readFileSync(join(abs, name));
      out.files.push({ path: rel, data, mode: st.mode & 0o777 });
      out.totalBytes += data.byteLength;
    }
  };
  walk("");
  return out;
}

/** File names that must never be uploaded (env files, keys, credentials, runtime data, local state). */
export const SECRET_FILE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "env file", re: /(^|\/)\.env(\.[^/]*)?$/ },
  { name: "key/cert store", re: /\.(pem|key|p12|pfx|jks|keystore)$/i },
  { name: "ssh key", re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/ },
  { name: "credentials file", re: /(^|\/)(\.npmrc|\.netrc|\.pgpass|credentials(\.[a-z]+)?)$/i },
  { name: "runtime data / scratch", re: /^(data|scratch|tmp)\// },
  { name: "dependencies / build output / vcs", re: /(^|\/)(node_modules|\.git)\/|^\.next\// },
];

/** The high-confidence content patterns of tests/unit/quality/secrets.test.ts. */
export const SECRET_CONTENT_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "JWT / Liara API key", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "provider API key", re: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{20,})\b/g },
];
/** Same allowance as the repo secret scan: visibly planted sample data. */
const PLANTED = /SYNTH|SYNTHETIC|E2E-|e2e-|EXAMPLE|example|PLACEHOLDER|placeholder|NOT-A-REAL|DUMMY|dummy|FAKE|fake/;

/** Values of secret-named variables in the process env (6+ chars): none may appear inside an uploaded file. */
export function envSecretValues(env: Env): string[] {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && v.trim().length >= 6 && isSecretKey(k)) out.add(v.trim());
  }
  return [...out];
}

/** Problems (path + reason, never the matched text) that make the archive unsafe to upload. */
export function scanArchiveFiles(files: readonly SourceFile[], knownSecrets: readonly string[] = []): string[] {
  const problems: string[] = [];
  for (const f of files) {
    for (const p of SECRET_FILE_PATTERNS) if (p.re.test(f.path)) problems.push(`${f.path}: ${p.name}`);
    const text = typeof f.data === "string" ? f.data : Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength).toString("utf8");
    for (const p of SECRET_CONTENT_PATTERNS) {
      for (const m of text.matchAll(new RegExp(p.re.source, p.re.flags))) {
        const around = text.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + m[0].length + 40);
        if (PLANTED.test(m[0]) || PLANTED.test(around)) continue;
        problems.push(`${f.path}: ${p.name}`);
        break;
      }
    }
    if (knownSecrets.some((s) => text.includes(s))) problems.push(`${f.path}: contains the value of a secret env variable`);
  }
  return problems;
}

/**
 * Root-level config files (playwright.config.ts, vitest.config.ts, ...) that import ./<dir> where nothing named <dir> is in
 * the archive. `next build` type-checks every root .ts file, so such a config fails the Liara build (it did: both test
 * configs import ./tests, which .liaraignore excludes). Also flags the two test configs outright when tests/ is absent.
 */
export function findDanglingConfigs(files: readonly SourceFile[]): string[] {
  const paths = files.map((f) => f.path);
  const present = (seg: string) => paths.some((p) => p === seg || p.startsWith(`${seg}/`) || p.startsWith(`${seg}.`));
  const problems: string[] = [];
  const hasTests = paths.some((p) => p.startsWith("tests/"));
  for (const name of ["playwright.config.ts", "vitest.config.ts"]) {
    if (!hasTests && paths.includes(name)) problems.push(`${name}: test config uploaded but tests/ is not (next build type-checking would fail); ignore it in .liaraignore`);
  }
  for (const f of files) {
    if (f.path.includes("/") || f.path.endsWith(".d.ts") || !/\.(?:[cm]?[jt]s)$/.test(f.path)) continue; // .d.ts: next-env.d.ts points at generated .next/
    const text = typeof f.data === "string" ? f.data : Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength).toString("utf8");
    for (const m of text.matchAll(/(?:from|import|require\()\s*\(?\s*["']\.\/([^/"']+)(?:\/[^"']*)?["']/g)) {
      if (!present(m[1]) && !problems.some((x) => x.startsWith(`${f.path}: imports`))) problems.push(`${f.path}: imports ./${m[1]}, which is not in the upload`);
    }
  }
  return problems;
}

export interface PreparedSource {
  collected: CollectedSource;
  archive: SourceArchive;
}

/** Collect -> secret scan (refuses on any hit) -> .tar.gz in memory with ignore rules already applied. */
export async function prepareSource(root: string, knownSecrets: readonly string[]): Promise<PreparedSource> {
  const collected = collectSource(root);
  for (const f of FORCE_INCLUDE) {
    if (!collected.files.some((x) => x.path === f)) throw new GuardError(`${f} is missing from the upload; refusing (Liara builds with npm ci)`);
  }
  const problems = scanArchiveFiles(collected.files, knownSecrets);
  if (problems.length > 0) throw new GuardError(`secret-looking files would be uploaded; fix .liaraignore first:\n  ${problems.slice(0, 20).join("\n  ")}`);
  const dangling = findDanglingConfigs(collected.files);
  if (dangling.length > 0) throw new GuardError(`the build would fail type checking; fix .liaraignore first:\n  ${dangling.join("\n  ")}`);
  const archive = await createSourceArchive({ files: collected.files }, { applyIgnore: false });
  return { collected, archive };
}


/* ------------------------------------------------------------------ private network */

/** What to do about the private network that g2 plans require (403 g2_plan_unavailable without one; verified live 2026-10-23). */
export type NetworkPlan =
  | { kind: "use"; name: string; note: string }
  | { kind: "create"; name: string; note: string }
  | { kind: "refuse"; message: string };

export interface NetworkOpts {
  /** --network <name>: an existing network. */
  network?: string;
  /** --create-network <name>: create it first when it does not exist (only with --yes). */
  createNetwork?: string;
}

const SUGGESTED_NETWORK = "hamyar-net";

function createNetworkCommand(teamMode: boolean): string {
  const q = teamMode ? "?teamID=<team id>" : "";
  return `curl -X POST "https://api.liara.ir/v1/networks${q}" -H "Authorization: Bearer $LIARA_API_TOKEN" -H "Content-Type: application/json" -d '{"networkName":"${SUGGESTED_NETWORK}"}'  (free, answers 201), or re-run with --yes --create-network ${SUGGESTED_NETWORK}`;
}

/** GET /v1/networks (read only) and decide; never creates anything. */
export async function planNetwork(client: LiaraClient, opts: NetworkOpts, teamMode: boolean): Promise<NetworkPlan> {
  if (opts.network !== undefined) return { kind: "use", name: opts.network, note: "from --network" };
  const nets = (await listNetworks(client)).filter((n): n is typeof n & { name: string } => Boolean(n.name));
  const wanted = opts.createNetwork;
  if (wanted !== undefined) {
    return nets.some((n) => n.name === wanted)
      ? { kind: "use", name: wanted, note: "--create-network: already exists, used as is" }
      : { kind: "create", name: wanted, note: "--create-network: does not exist; POST /v1/networks (free, 201) before the app, only with --yes" };
  }
  if (nets.length === 1) return { kind: "use", name: nets[0].name, note: "the only private network on the account, used automatically (pass --network to choose another)" };
  if (nets.length === 0) {
    return {
      kind: "refuse",
      message: `no private network exists and g2 plans are refused without one (403 g2_plan_unavailable). Create one: ${createNetworkCommand(teamMode)}`,
    };
  }
  return { kind: "refuse", message: `${nets.length} private networks exist (${nets.map((n) => n.name).join(", ")}); pass --network <name> to choose one` };
}

const networkLine = (n: NetworkPlan): string =>
  n.kind === "refuse" ? `network   : REFUSED: ${n.message}` : `network   : ${n.name} (${n.kind === "create" ? "to be created" : "existing"}; ${n.note})`;

/* ------------------------------------------------------------------ plan + cost */

export interface PlanPick {
  plan: NormalizedPlan;
  choice: PlanChoice;
  reason: string;
}

/** small-g2 when available and priced, else the cheapest available non-free plan with a known price; bundle `basic`. */
export function pickPlan(me: Me): PlanPick {
  const priced = listAppPlans(me).filter((p) => p.available && p.id !== "free" && p.priceKnown && p.pricePerHour > 0);
  if (priced.length === 0) throw new GuardError("no available non-free app plan with a known price in GET /v1/me; refusing (assertPriced)");
  const preferred = priced.find((p) => p.id === PREFERRED_PLAN);
  const plan = preferred ?? [...priced].sort((a, b) => a.pricePerHour - b.pricePerHour)[0];
  const choice = choosePlan(appPlans(me), plan.id, BUNDLE);
  assertPriced(choice);
  return { plan, choice, reason: preferred ? `preferred ${PREFERRED_PLAN}` : `${PREFERRED_PLAN} not available; cheapest priced plan` };
}

export interface CostEstimate {
  planHourly: number;
  bundleMonthly: number;
  /** bundle additive to the plan price (verified live 2026-10-23): monthly / 720. */
  bundleHourly: number;
  /** disk part of `hourly`: DISK_SIZE_GB x DISK_HOURLY_TOMAN_PER_GB (INFERRED live, see DISK_HOURLY_TOMAN_PER_GB). */
  diskHourly: number;
  /** plan + bundle + disk. */
  hourly: number;
  monthly: number;
  projected: number;
  requiredBalance: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function estimateCost(pick: PlanPick): CostEstimate {
  const bundleMonthly = pick.choice.bundleMonthlyToman;
  if (bundleMonthly === undefined || !Number.isFinite(bundleMonthly) || bundleMonthly < 0) {
    throw new GuardError(`bundle "${BUNDLE}" of ${pick.plan.id} has no known price; refusing (cost must be known before a billed step)`);
  }
  const planHourly = pick.plan.pricePerHour;
  const bundleHourly = bundleMonthly / 720;
  const diskHourly = DISK_SIZE_GB * DISK_HOURLY_TOMAN_PER_GB;
  const hourly = planHourly + bundleHourly + diskHourly;
  const projected = hourly * PROJECTION_HOURS;
  return {
    planHourly: r2(planHourly),
    bundleMonthly,
    bundleHourly: r2(bundleHourly),
    diskHourly: r2(diskHourly),
    hourly: r2(hourly),
    monthly: r2(hourly * 720),
    projected: r2(projected),
    requiredBalance: r2(projected * BALANCE_FACTOR),
  };
}

export function assertWithinCap(cost: CostEstimate, capToman: number): void {
  if (cost.projected > capToman) {
    throw new GuardError(`projected ${PROJECTION_HOURS}h cost ${cost.projected} toman exceeds SPEND_CAP_TOMAN ${capToman}`);
  }
}

/** Fresh balance gate for the billed steps: readable, >= BALANCE_FACTOR x projected cost, >= Liara's min credit. */
export function assertBalance(b: NormalizedBilling, cost: CostEstimate): number {
  if (b.teamUnreadable) throw new GuardError("team balance is unreadable (GET /v1/billing has no usable `team`); refusing the billed steps");
  if (b.balance === undefined) throw new GuardError(`${b.source} balance is unreadable; refusing the billed steps`);
  if (b.balance < cost.requiredBalance) {
    throw new GuardError(`${b.source} balance ${b.balance} toman is below ${BALANCE_FACTOR}x the projected ${PROJECTION_HOURS}h cost (${cost.requiredBalance})`);
  }
  if (b.minCreditAmount !== undefined && b.balance < b.minCreditAmount) {
    throw new GuardError(`${b.source} balance ${b.balance} is below Liara's minimum credit ${b.minCreditAmount}`);
  }
  return b.balance;
}

/* ------------------------------------------------------------------ helpers */

interface Ctx {
  deps: DeploySelfDeps;
  cfg: Config;
  lj: LiaraJson;
  root: string;
  secrets: string[];
  out: (line: string) => void;
}

function makeCtx(deps: DeploySelfDeps, cfg: Config, lj: LiaraJson, root: string, extraSecrets: string[] = []): Ctx {
  const secrets = [...new Set([...envSecretValues(deps.env), ...extraSecrets])];
  return { deps, cfg, lj, root, secrets, out: (line) => deps.io.out(redactLine(line, secrets)) };
}

const generateKey = () => randomBytes(48).toString("base64");

function mountOf(lj: LiaraJson) {
  return lj.disks.find((d) => d.name === DISK_NAME) ?? { name: DISK_NAME, mountTo: DISK_NAME };
}

export function appendSpendLog(path: string, entry: Record<string, unknown>, secrets: readonly string[] = []): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(redactForOutput(entry, secrets)) + "\n", { encoding: "utf8", mode: 0o600 });
}

async function readBilling(client: LiaraClient): Promise<NormalizedBilling | undefined> {
  try {
    return await getAccountBilling(client);
  } catch {
    return undefined;
  }
}

async function appExists(client: LiaraClient, app: string): Promise<boolean> {
  try {
    await getApp(client, app);
    return true;
  } catch (e) {
    if (isLiaraError(e) && e.kind === "not_found") return false;
    throw e;
  }
}

type DiskLookup = { ok: true; found: boolean; mounted: boolean } | { ok: false; error: string };

/** Disks are listed by the project `_id` (lib/liara/disks.ts); a failed lookup is NOT the same as "no disk". */
async function lookupDisk(client: LiaraClient, app: string, secrets: readonly string[]): Promise<DiskLookup> {
  try {
    const res = await listDisks(client, app);
    return {
      ok: true,
      found: res.disks.some((d) => d.name === DISK_NAME),
      mounted: res.mounts.length > 0,
    };
  } catch (e) {
    return { ok: false, error: describeError(e, secrets).message };
  }
}

function describeAny(e: unknown, secrets: readonly string[]) {
  if (isActionError(e)) {
    const guardish = ["insufficient_balance", "team_balance_unreadable", "plan_price_unknown", "invalid", "conflict", "human_only", "payment_required"];
    const details = e.details ? ` ${JSON.stringify(e.details)}` : "";
    return { exitCode: guardish.includes(e.code) ? EXIT.guard : EXIT.liara, message: redactLine(`action error ${e.code}${details}`, [...secrets, ...e.knownSecrets]) };
  }
  return describeError(e, secrets);
}

function accountLines(ctx: Ctx, me: Me | undefined, billing: NormalizedBilling | undefined, client: LiaraClient) {
  const acct = me ? normalizeAccount(me, teamIdOf(client)) : undefined;
  const who =
    acct?.source === "team"
      ? acct.teamUnreadable
        ? "team (LIARA_TEAM_ID set) but GET /v1/me has no team object: UNREADABLE"
        : `team "${acct.teamName ?? "?"}" (role ${acct.teamMemberRole ?? "?"})`
      : "user (personal account; no LIARA_TEAM_ID)";
  ctx.out(`account   : ${who}`);
  if (!billing) ctx.out("balance   : UNREADABLE (GET /v1/billing failed)");
  else if (billing.teamUnreadable) ctx.out("balance   : team balance UNREADABLE (billed steps would be refused)");
  else ctx.out(`balance   : ${billing.balance ?? "unknown"} toman (${billing.source} wallet)${billing.minCreditAmount !== undefined ? `, Liara min credit ${billing.minCreditAmount}` : ""}`);
}

function costLines(ctx: Ctx, pick: PlanPick, cost: CostEstimate) {
  const p = pick.plan;
  const hw = [p.ramGb !== undefined ? `${p.ramGb} GB RAM` : "", p.cpu !== undefined ? `${p.cpu} CPU` : "", p.diskGb !== undefined ? `${p.diskGb} GB volume` : ""].filter(Boolean).join(" / ");
  ctx.out(`plan      : ${p.id} (${pick.reason}${hw ? `; ${hw}` : ""}) ${cost.planHourly} toman/hour`);
  ctx.out(`bundle    : ${BUNDLE} ${cost.bundleMonthly} toman/month = ${cost.bundleHourly}/hour (verified live 2026-10-23: additive to the plan price)`);
  ctx.out(`disk      : ${DISK_NAME} ${DISK_SIZE_GB} GB: ${cost.diskHourly} toman/hour (INFERRED live 2026-10-23 from the first-hour charge 1145.83 = 659.72 + 381.94 + 104.17; not a Liara-documented price; GET /v1/me lists none)`);
  ctx.out(`cost      : ${cost.hourly} toman/hour (plan + bundle + disk), ~${cost.monthly} toman/month (hourly x 720)`);
  ctx.out(`projected : ${cost.projected} toman for ${PROJECTION_HOURS} hours; balance required ${cost.requiredBalance} (${BALANCE_FACTOR}x); spend cap ${ctx.cfg.capToman}: ${cost.projected <= ctx.cfg.capToman ? "OK" : "EXCEEDED"}`);
}

function steps(ctx: Ctx, net?: NetworkPlan): string[] {
  const { app } = ctx.cfg;
  const mount = mountOf(ctx.lj);
  return [
    `re-read billing (GET), require balance >= ${BALANCE_FACTOR}x the ${PROJECTION_HOURS}h cost and >= min credit; refuse when unreadable`,
    net?.kind === "create"
      ? `create the private network ${net.name} first: executeAction create_network (POST /v1/networks, free)`
      : "private network: reuse the one chosen above (g2 plans are refused without one)",
    `create app ${app} (BILLED): executeAction create_app {platform next, plan, bundle ${BUNDLE}, network ${net && net.kind !== "refuse" ? net.name : "<resolved at run time from GET /v1/networks>"}} (name-free check, plan + price check, team-aware balance check)`,
    `create disk ${DISK_NAME} (${DISK_SIZE_GB} GB): POST /v1/projects/${app}/disks; a 4xx refusal continues WITHOUT a disk`,
    `set env ${ENV_NAMES.join(", ")}: executeAction set_env (full-list update-envs + readback; restarts the app; values never printed)`,
    `upload the .tar.gz (POST /v2/projects/{app}/sources) and create the release (POST /v2/projects/{app}/releases): port ${ctx.lj.port}, type ${ctx.lj.platform}, disks [${mount.name} -> ${mount.mountTo}] when the disk exists, platformConfig = liara.json "next"`,
    `watch build logs + state until READY/FAILED/TIMEDOUT/UNHEALTHY/CANCELED (hard timeout ${WATCH_TIMEOUT_MS / 60_000} min; every line redacted)`,
    "probe GET /api/health (+ GET /) on the default URL from the app detail and any custom domain; print a PASS/FAIL table",
    "append the spend log line (scratch/spend-log.jsonl); on any failure print what exists and exit non-zero",
  ];
}

function releaseOnlySteps(ctx: Ctx): string[] {
  const { app } = ctx.cfg;
  const mount = mountOf(ctx.lj);
  return [
    `verify app ${app} exists (GET /v1/projects/${app}); refuse when it does not, or when it is stopped (scale 0)`,
    `read the disks by the project _id (GET /v1/projects/{_id}/disks): the release mounts [${mount.name} -> ${mount.mountTo}]; REFUSES when the lookup fails or the disk ${DISK_NAME} is missing, unless --no-disk`,
    "after the release read GET /v1/projects/{_id}/disks again and print PASS/FAIL \"disk mounted\" (mounts non-empty)",
    `upload the .tar.gz (POST /v2/projects/{app}/sources) and create the release (POST /v2/projects/{app}/releases): port ${ctx.lj.port}, type ${ctx.lj.platform}, platformConfig = liara.json "next"`,
    `watch build logs + state until READY/FAILED/TIMEDOUT/UNHEALTHY/CANCELED (hard timeout ${WATCH_TIMEOUT_MS / 60_000} min; every line redacted); on failure print the last ${FAIL_TAIL_LINES} STDERR lines and failReason`,
    "probe GET /api/health (+ GET /) on the default URL from the app detail and any custom domain; print a PASS/FAIL table",
    'append the spend log line `step: "release_only"` (scratch/spend-log.jsonl)',
    "NOT done: create_app, disk create, set_env, plan pricing, balance gating (the app, its disk and its env vars are left as they are)",
  ];
}

/* ------------------------------------------------------------------ dry run */

async function dryRunReleaseOnly(ctx: Ctx, prepared: PreparedSource, noDisk: boolean): Promise<number> {
  const { deps, cfg, lj } = ctx;
  const mount = mountOf(lj);
  ctx.out("DRY RUN (--release-only): nothing is changed (GET requests only). Re-run with --release-only --yes to redeploy.");
  ctx.out(SEP);
  ctx.out(`app       : ${cfg.app}${lj.app && lj.app !== cfg.app ? ` (NOTE: liara.json says "${lj.app}")` : ""}`);
  ctx.out(`platform  : ${lj.platform}, port ${lj.port}, platformConfig ${JSON.stringify(lj.next ?? {})}`);
  const c = prepared.collected;
  ctx.out(`source    : ${c.files.length} files, ${c.totalBytes} bytes -> ${prepared.archive.size} bytes .tar.gz (.liaraignore + CLI defaults; forced in: ${FORCE_INCLUDE.join(", ")})`);
  ctx.out(`            secret scan: clean; ${c.ignoredCount} paths ignored${c.skippedSymlinks.length ? `; symlinks skipped: ${c.skippedSymlinks.join(", ")}` : ""}`);
  if (deps.env.ALLOW_BILLED_LIVE_TESTS !== "1") ctx.out("note      : --yes would be REFUSED: ALLOW_BILLED_LIVE_TESTS=1 is not set");
  if (!hasToken(deps.env)) {
    ctx.out("offline   : LIARA_API_TOKEN is not set, so the app and its disks were not looked up");
  } else {
    const client = liaraFromEnv(deps.env, { fetchImpl: deps.fetchImpl });
    const exists = await appExists(client, cfg.app);
    ctx.out(`lookup    : app ${cfg.app} ${exists ? "exists" : "does NOT exist (--release-only --yes would refuse)"}`);
    if (exists) {
      const lk = await lookupDisk(client, cfg.app, ctx.secrets);
      if (lk.ok && lk.found) ctx.out(`disk      : ${DISK_NAME} exists; the release would mount it at ${mount.mountTo}`);
      else {
        const why = lk.ok ? `disk ${DISK_NAME} not found` : `disk lookup failed (${lk.error})`;
        ctx.out(`disk      : ${why}; ${noDisk ? "--no-disk: the release would carry no disks" : "--release-only --yes would REFUSE (pass --no-disk to release without a disk)"}`);
      }
    }
  }
  ctx.out("steps (--release-only --yes):");
  releaseOnlySteps(ctx).forEach((s, i) => ctx.out(`  ${i + 1}. ${s}`));
  return EXIT.ok;
}

async function dryRun(ctx: Ctx, prepared: PreparedSource, netOpts: NetworkOpts): Promise<number> {
  const { deps, cfg, lj } = ctx;
  const mount = mountOf(lj);
  let netPlan: NetworkPlan | undefined;
  ctx.out("DRY RUN: nothing is changed (GET requests only). Re-run with --yes to deploy (BILLED).");
  ctx.out(SEP);
  ctx.out(`app       : ${cfg.app}${lj.app && lj.app !== cfg.app ? ` (NOTE: liara.json says "${lj.app}")` : ""}`);
  ctx.out(`platform  : ${lj.platform}, port ${lj.port}, platformConfig ${JSON.stringify(lj.next ?? {})}`);
  ctx.out(`disk      : ${mount.name} mounted at ${mount.mountTo} -> DATA_DIR=${dataDirFor(mount.mountTo)} [VAL mount path]`);
  ctx.out(`env names : ${ENV_NAMES.join(", ")} (both keys generated separately, 48 random bytes each, base64; values never printed or stored)`);
  const c = prepared.collected;
  ctx.out(`source    : ${c.files.length} files, ${c.totalBytes} bytes -> ${prepared.archive.size} bytes .tar.gz (.liaraignore + CLI defaults; forced in: ${FORCE_INCLUDE.join(", ")})`);
  ctx.out(`            secret scan: clean; ${c.ignoredCount} paths ignored${c.skippedSymlinks.length ? `; symlinks skipped: ${c.skippedSymlinks.join(", ")}` : ""}`);
  if (deps.env.ALLOW_BILLED_LIVE_TESTS !== "1") ctx.out("note      : --yes would be REFUSED: ALLOW_BILLED_LIVE_TESTS=1 is not set");
  if (!hasToken(deps.env)) {
    ctx.out("offline   : LIARA_API_TOKEN is not set, so account, balance, plan and price were not read (cost: unknown)");
  } else {
    const client = liaraFromEnv(deps.env, { fetchImpl: deps.fetchImpl });
    const me = await getMe(client);
    const billing = await readBilling(client);
    accountLines(ctx, me, billing, client);
    const exists = await appExists(client, cfg.app);
    ctx.out(`lookup    : app ${cfg.app} ${exists ? "ALREADY EXISTS (--yes would refuse; use --destroy first)" : "does not exist"}`);
    const pick = pickPlan(me);
    const cost = estimateCost(pick);
    costLines(ctx, pick, cost);
    if (cost.projected > cfg.capToman) ctx.out("note      : --yes would be REFUSED: projected cost exceeds SPEND_CAP_TOMAN");
    if (billing && !billing.teamUnreadable && billing.balance !== undefined && billing.balance < cost.requiredBalance) {
      ctx.out(`note      : --yes would be REFUSED: balance below ${cost.requiredBalance}`);
    }
    const net = await planNetwork(client, netOpts, cfg.teamMode);
    netPlan = net;
    ctx.out(networkLine(net));
    if (net.kind === "refuse") ctx.out("note      : --yes would be REFUSED: no usable private network (see above)");
  }
  ctx.out("steps (--yes):");
  steps(ctx, netPlan).forEach((s, i) => ctx.out(`  ${i + 1}. ${s}`));
  return EXIT.ok;
}

/* ------------------------------------------------------------------ probe */

export interface ProbeRow {
  check: string;
  pass: boolean;
  detail: string;
  /** Not evaluated (e.g. an older build without the field): printed SKIP, never counted as a failure. */
  skip?: boolean;
}

export const PERSISTENT_ROW = "data dir on mounted disk";

async function fetchWithTimeout(f: typeof fetch, url: string, timeoutMs: number): Promise<Response | string> {
  try {
    return await f(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  } catch (e) {
    return e instanceof Error ? e.name : "error";
  }
}

export async function probeUrl(base: string, f: typeof fetch, opts: { attempts: number; intervalMs: number; timeoutMs: number }, sleep: (ms: number) => Promise<void>): Promise<ProbeRow[]> {
  const rows: ProbeRow[] = [];
  let res: Response | string = "not tried";
  for (let i = 0; i < opts.attempts; i++) {
    res = await fetchWithTimeout(f, `${base}/api/health`, opts.timeoutMs);
    if (typeof res !== "string" && res.status === 200) break;
    if (i < opts.attempts - 1) await sleep(opts.intervalMs);
  }
  if (typeof res === "string") return [{ check: `${base}/api/health reachable`, pass: false, detail: res }];
  rows.push({ check: `${base}/api/health 200`, pass: res.status === 200, detail: `status ${res.status}` });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const checks = (body.checks ?? {}) as Record<string, unknown>;
  // "degraded" = serving but not persistent; that is judged by the "data dir on mounted disk" row below.
  rows.push({ check: "body.status is ok or degraded", pass: body.status === "ok" || body.status === "degraded", detail: String(body.status ?? "missing") });
  rows.push({ check: "checks.sessionKey is true", pass: checks.sessionKey === true, detail: String(checks.sessionKey ?? "missing") });
  rows.push({ check: "checks.dataDir is writable", pass: checks.dataDir === "writable", detail: String(checks.dataDir ?? "missing") });
  const persistent = checks.dataDirPersistent;
  if (persistent === "mounted" || persistent === "not_mounted") {
    rows.push({ check: PERSISTENT_ROW, pass: persistent === "mounted", detail: persistent === "mounted" ? "mounted" : "not_mounted: the container filesystem is temporary, data is lost on restart" });
  } else {
    rows.push({ check: PERSISTENT_ROW, pass: false, skip: true, detail: persistent === "unknown" ? "unknown (the app could not tell)" : "not reported (older build)" });
  }
  const cc = res.headers.get("cache-control") ?? "";
  rows.push({ check: "cache-control no-store", pass: /no-store/i.test(cc), detail: cc || "missing" });
  rows.push({ check: "strict-transport-security set", pass: res.headers.has("strict-transport-security"), detail: res.headers.has("strict-transport-security") ? "present" : "missing" });
  rows.push({ check: "x-powered-by absent", pass: !res.headers.has("x-powered-by"), detail: res.headers.get("x-powered-by") ?? "absent" });
  const home = await fetchWithTimeout(f, `${base}/`, opts.timeoutMs);
  rows.push({ check: `${base}/ < 500`, pass: typeof home !== "string" && home.status < 500, detail: typeof home === "string" ? home : `status ${home.status}` });
  return rows;
}

/** Hosts to probe: the default sub-domain (`https://<app>.liara.run`; no other form exists), then custom domains. */
export function candidateUrls(app: string, defaultSubdomain: boolean | undefined, domains: readonly string[]): string[] {
  const out: string[] = [];
  if (defaultSubdomain !== false) out.push(`https://${app}.liara.run`);
  for (const d of domains) if (/^[a-z0-9.-]+$/i.test(d)) out.push(`https://${d.toLowerCase()}`);
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ deploy (--yes) */

interface Existing {
  app: boolean;
  disk: boolean;
  envKeys: string[];
  releaseId?: string;
  releaseState?: string;
}

function printExisting(ctx: Ctx, ex: Existing) {
  ctx.deps.io.err("RESOURCES THAT EXIST NOW (clean up with --destroy):");
  ctx.deps.io.err(`  app ${ctx.cfg.app}: ${ex.app ? "CREATED (billed hourly until deleted)" : "not created"}`);
  ctx.deps.io.err(`  disk ${DISK_NAME}: ${ex.disk ? "created" : "not created"}`);
  ctx.deps.io.err(`  env vars: ${ex.envKeys.length ? ex.envKeys.join(", ") : "none set"}`);
  ctx.deps.io.err(`  release: ${ex.releaseId ? `${ex.releaseId} (${ex.releaseState ?? "state unknown"})` : "none"}`);
  if (ex.app) ctx.deps.io.err(`  cleanup: ${SCRIPT} --destroy --yes --confirm-name ${ctx.cfg.app}`);
}

/** Release-only: the final report reads the REAL state (app detail, disks by `_id`, env var NAMES) instead of what this run did. */
async function printRealState(ctx: Ctx, client: LiaraClient, ex: Existing, ok = false) {
  const err = ok ? ctx.out : ctx.deps.io.err;
  err(`CURRENT STATE OF ${ctx.cfg.app} (read from Liara just now):`);
  try {
    const app = await getApp(client, ctx.cfg.app);
    err(`  app: exists, status ${app.status ?? "unknown"}, scale ${app.scale ?? "unknown"}, deployed ${String(app.isDeployed ?? "unknown")}`);
    const names = app.envs.map((e) => e.key).filter(Boolean);
    err(`  env vars (names only): ${names.length ? names.join(", ") : "none"}`);
  } catch (e) {
    err(`  app/env vars: could not be read (${describeError(e, ctx.secrets).message})`);
  }
  const lk = await lookupDisk(client, ctx.cfg.app, ctx.secrets);
  if (lk.ok) err(`  disk ${DISK_NAME}: ${lk.found ? "exists" : "NOT found"}; ${lk.mounted ? "mounted by a release" : "NOT mounted by any release"}`);
  else err(`  disks: could not be read (${lk.error})`);
  err(`  release: ${ex.releaseId ? `${ex.releaseId} (${ex.releaseState ?? "state unknown"})` : "none created by this run"}`);
}

function requireMutationsAllowed(env: Env) {
  if (env.ALLOW_BILLED_LIVE_TESTS !== "1") throw new GuardError("refusing to mutate Liara: set ALLOW_BILLED_LIVE_TESTS=1 to allow billed live steps");
  if (!hasToken(env)) throw new GuardError("LIARA_API_TOKEN is not set (run with: npx tsx --env-file=.env scripts/deploy-self.ts)");
}

const execCtx = (client: LiaraClient) => ({ liara: client, accountId: "deploy-self-cli" });

/** Last STDERR build lines (redacted) and the release's failReason, printed when a release ends FAILED. */
async function printFailureReport(ctx: Ctx, client: LiaraClient, releaseId: string, state: string, seenStderr: readonly string[], failReason?: string): Promise<void> {
  let stderr = [...seenStderr];
  let reason = failReason;
  try {
    // the watcher stops at the first STDERR line, so re-read the whole build output once (read-only)
    const r = await getBuildLogs(client, releaseId);
    const all = r.buildOutput.filter((l) => l.stream === "STDERR").map((l) => l.line);
    if (all.length > 0) stderr = all;
    reason = reason ?? r.release?.failReason;
  } catch {
    // keep what the watcher saw
  }
  const { err } = ctx.deps.io;
  err(`release ${releaseId} ended ${state}${reason ? `: failReason ${redactLine(reason, ctx.secrets)}` : " (the API gave no failReason)"}`);
  const tail = stderr.slice(-FAIL_TAIL_LINES);
  if (tail.length === 0) err("no STDERR build lines were available (see the build log in the Liara console)");
  else {
    err(`last ${tail.length} build STDERR line${tail.length === 1 ? "" : "s"}:`);
    for (const l of tail) err(`  ${redactLine(l, ctx.secrets)}`);
  }
}

async function deploy(ctx: Ctx, prepared: PreparedSource, netOpts: NetworkOpts, releaseOnly = false, noDisk = false): Promise<number> {
  const { deps, cfg, lj } = ctx;
  const client = liaraFromEnv(deps.env, { fetchImpl: deps.fetchImpl });
  const spendLog = deps.spendLogPath ?? join(ctx.root, "scratch", "spend-log.jsonl");
  const now = deps.now ?? Date.now;
  const ex: Existing = { app: false, disk: false, envKeys: [] };
  let pick: PlanPick | undefined;
  let cost: CostEstimate | undefined;
  let balanceBefore: number | undefined;
  const log = async (step: string, extra: Record<string, unknown> = {}) => {
    const after = await readBilling(client);
    appendSpendLog(spendLog, {
      ts: new Date(now()).toISOString(),
      step,
      app: cfg.app,
      account: cfg.teamMode ? "team" : "user",
      plan: pick?.plan.id ?? null,
      bundle: BUNDLE,
      hourlyToman: cost?.hourly ?? null,
      balanceBefore: balanceBefore ?? null,
      balanceAfter: after?.balance ?? null,
      ...extra,
    }, ctx.secrets);
    return after?.balance;
  };

  const mount = mountOf(lj);
  const stderrSeen: string[] = [];
  ctx.out(`deploy-self: ${cfg.app} (${releaseOnly ? "RELEASE ONLY: existing app, one release consumes build quota" : "BILLED"})`);
  ctx.out(`source    : ${prepared.collected.files.length} files, ${prepared.archive.size} bytes .tar.gz; secret scan clean`);
  try {
    if (releaseOnly) {
      if (!(await appExists(client, cfg.app))) throw new GuardError(`app ${cfg.app} does not exist; --release-only needs an existing app (run without --release-only to create it)`);
      ex.app = true;
      const lk = await lookupDisk(client, cfg.app, ctx.secrets);
      ex.disk = lk.ok && lk.found;
      if (!ex.disk && !noDisk) {
        throw new GuardError(
          lk.ok
            ? `disk ${DISK_NAME} was not found on ${cfg.app}; refusing to release without it (the app would lose its data on restart). Create the disk first, or pass --no-disk to release without one`
            : `could not look up the disks of ${cfg.app} (${lk.error}); refusing to release without the persistent disk (the app would lose its data on restart). Retry, or pass --no-disk to release without one`,
        );
      }
      balanceBefore = (await readBilling(client))?.balance;
      ctx.out(`existing  : app ${cfg.app} found; disk ${DISK_NAME} ${ex.disk ? `found (mount at ${mount.mountTo})` : `${lk.ok ? "not found" : "lookup failed"}: --no-disk, the release carries no disks (data is NOT persistent)`}; no create_app, disk or env steps`);
    } else {
      const me = await getMe(client);
      pick = pickPlan(me);
      cost = estimateCost(pick);
      costLines(ctx, pick, cost);
      assertWithinCap(cost, cfg.capToman);
      if (await appExists(client, cfg.app)) throw new GuardError(`app ${cfg.app} already exists; refusing to reuse it (run --destroy first, or --release-only to redeploy)`);

      // (a) fresh balance gate
      const billing = await getAccountBilling(client).catch((e: unknown) => {
        throw new GuardError(`GET /v1/billing failed (${describeError(e, ctx.secrets).message}); refusing the billed steps`);
      });
      accountLines(ctx, me, billing, client);
      balanceBefore = assertBalance(billing, cost);

      // (a2) private network (g2 plans are refused without one): decide with reads, refuse BEFORE anything billed
      const net = await planNetwork(client, netOpts, cfg.teamMode);
      ctx.out(networkLine(net));
      if (net.kind === "refuse") throw new GuardError(net.message);
      if (net.kind === "create") {
        await executeAction(execCtx(client), { type: "create_network", name: net.name }, { source: "user" });
        ctx.out(`            private network ${net.name} created (free)`);
      }
      const network = net.name;

      // (b) create the app through the guarded executor
      ctx.out(`step 1/6  : creating app ${cfg.app} (BILLED ${cost.hourly} toman/hour)`);
      const createParams: ActionParams = { type: "create_app", name: cfg.app, platform: "next", planId: pick.choice.planId, bundlePlanId: pick.choice.bundlePlanId, network };
      let created: ExecResult;
      try {
        created = await executeAction(execCtx(client), createParams, { source: "user" });
      } catch (e) {
        // outcome_unknown: the app may exist; re-check with a read (never a retry) so the cleanup list is right.
        ex.app = await appExists(client, cfg.app).catch(() => true);
        throw e;
      }
      ex.app = true;
      ctx.out(`            created: ${JSON.stringify(created.after ?? {})}; balanceChecked=${String(created.summary.balanceChecked)}`);
      await log("create_app");

      // (c) disk
      ctx.out(`step 2/6  : creating disk ${DISK_NAME} (${DISK_SIZE_GB} GB)`);
      try {
        const hasDisk = async () => (await listDisks(client, cfg.app)).disks.some((d) => d.name === DISK_NAME);
        await mutateOnce("create_disk", () => createDisk(client, cfg.app, DISK_NAME, DISK_SIZE_GB), async () => ({ confirmed: await hasDisk() }));
        ex.disk = true;
        ctx.out(`            disk ${DISK_NAME} created; will mount at ${mount.mountTo}`);
      } catch (e) {
        const refused = isActionError(e) && ["invalid", "forbidden", "unsupported", "precondition", "not_found", "conflict"].includes(e.code);
        if (!refused) throw e;
        ctx.out(`WARNING   : disk create refused (${describeAny(e, ctx.secrets).message}); continuing WITHOUT a disk: ${dataDirFor(mount.mountTo)} is not persistent`);
      }

      // (d) env vars: generated keys go in as request-scoped user values (never printed, never written to disk)
      ctx.out(`step 3/6  : setting env ${ENV_NAMES.join(", ")} (values hidden)`);
      const sessionKey = generateKey();
      const approvalKey = generateKey();
      ctx.secrets.push(sessionKey, approvalKey);
      const userValues: Record<(typeof ENV_NAMES)[number], string> = {
        APP_SESSION_KEY: sessionKey,
        APP_APPROVAL_KEY: approvalKey,
        TRUSTED_PROXY_HOPS: "1",
        DATA_DIR: dataDirFor(mount.mountTo),
      };
      const envParams: ActionParams = { type: "set_env", app: cfg.app, changes: ENV_NAMES.map((key) => ({ op: "set" as const, key, valueSource: "user" as const })) };
      let envResult: ExecResult;
      try {
        envResult = await executeAction(execCtx(client), envParams, { source: "user", userValues });
      } catch (e) {
        ex.envKeys = ["unknown: set_env failed after or before update-envs (check the console)"];
        throw e;
      }
      ex.envKeys = [...ENV_NAMES];
      ctx.out(`            env readback=${String(envResult.summary.readback)} keysAfter=${String(envResult.summary.keysAfter)}`);
    }

    // (e) archive -> upload -> release -> watch
    ctx.out(`${releaseOnly ? "step 1/3  " : "step 4/6  "}: uploading ${prepared.archive.size} bytes and creating the release`);
    const detail = await getApp(client, cfg.app);
    if (detail.scale === 0) throw new GuardError(`app ${cfg.app} is stopped (scale 0); refusing to deploy`);
    const sourceID = await uploadSource(client, cfg.app, prepared.archive.data);
    ex.releaseId = await createRelease(client, cfg.app, {
      sourceID,
      port: lj.port,
      type: lj.platform,
      message: `hamyar deploy-self ${new Date(now()).toISOString()}`,
      ...(ex.disk ? { disks: [{ name: mount.name, mountTo: mount.mountTo }] } : {}),
      ...(lj.next ? { platformConfig: lj.next } : {}),
    });
    ex.releaseState = "CREATED";
    ctx.out(`            release ${ex.releaseId} created; watching (max ${WATCH_TIMEOUT_MS / 60_000} min)`);

    const timeoutMs = Math.min(deps.watch?.timeoutMs ?? WATCH_TIMEOUT_MS, WATCH_TIMEOUT_MS);
    const deadline = Date.now() + timeoutMs;
    let done: { state: string; ok: boolean; reason?: string; failReason?: string } = { state: "UNKNOWN", ok: false };
    for await (const ev of watchRelease(client, ex.releaseId, { ...deps.watch, timeoutMs })) {
      if (ev.kind === "state") ctx.out(`state     : ${ev.state}${ev.queue ? ` (queue ${ev.queue})` : ""}`);
      else if (ev.kind === "log") {
        if (ev.stream === "STDERR") stderrSeen.push(ev.line);
        ctx.out(`  build ${ev.stream === "STDERR" ? "err" : "out"}| ${ev.line}`);
      } else {
        done = ev;
        ctx.out(`watch end : ${ev.state}${ev.failReason ? ` (${ev.failReason})` : ""}${ev.reason ? ` [${ev.reason}]` : ""}`);
      }
    }
    if (done.reason === "build_stderr") {
      // The watcher stops on the first STDERR line (CLI rule); follow the real state read-only until terminal.
      ctx.out("            following the release state after a STDERR line (read-only)");
      for await (const ev of watchRelease(client, ex.releaseId, { ...deps.watch, buildLogs: false, timeoutMs: Math.max(1, deadline - Date.now()) })) {
        if (ev.kind === "state") ctx.out(`state     : ${ev.state}`);
        else if (ev.kind === "done") done = { ...ev, failReason: ev.failReason ?? done.failReason };
      }
    }
    ex.releaseState = done.state;
    ctx.out(`release   : ${done.state}`);
    if (!done.ok && (done.state === "FAILED" || done.state === "UNHEALTHY")) await printFailureReport(ctx, client, ex.releaseId, done.state, stderrSeen, done.failReason);
    if (!done.ok) throw new Error(`release ended ${done.state}${done.reason ? ` (${done.reason})` : ""}`);

    // (f) probe
    ctx.out(`${releaseOnly ? "step 2/3  " : "step 5/6  "}: probing the public URL`);
    const app = await getApp(client, cfg.app);
    const domains = await listDomains(client, cfg.app).then((ds) => ds.flatMap((d) => (d.name ? [d.name] : []))).catch(() => [] as string[]);
    const urls = candidateUrls(cfg.app, app.defaultSubdomain, domains);
    ctx.out(`            defaultSubdomain=${String(app.defaultSubdomain ?? "unknown")}; candidates: ${urls.join(", ") || "none"}`);
    const p = { attempts: deps.probe?.attempts ?? 10, intervalMs: deps.probe?.intervalMs ?? 15_000, timeoutMs: deps.probe?.timeoutMs ?? 15_000 };
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let anyPass = false;
    let persistFail = false;
    const table: string[] = [];
    for (const [i, url] of urls.entries()) {
      // later hosts (custom domains) get one attempt: the default URL already waited for the app to warm up
      const rows = await probeUrl(url, deps.probeFetch ?? fetch, { ...p, attempts: i === 0 ? p.attempts : 1 }, sleep);
      const core = rows.filter((r) => /api\/health 200|body\.status|sessionKey|dataDir/.test(r.check));
      if (core.length === 4 && core.every((r) => r.pass)) anyPass = true;
      for (const r of rows) {
        const isPersist = r.check === PERSISTENT_ROW;
        // Without a disk in this release (--no-disk) a temporary DATA_DIR is the chosen outcome, not a failure.
        const skip = r.skip || (isPersist && !r.pass && !ex.disk);
        table.push(`  ${skip ? "SKIP" : r.pass ? "PASS" : "FAIL"}  ${r.check.padEnd(48)} ${r.detail}${skip && !r.skip ? " (no disk in this release)" : ""}`);
        if (isPersist && !r.pass && !skip) persistFail = true;
      }
    }
    // disk mounted: re-read GET /v1/projects/{_id}/disks; `mounts` must be non-empty once a release mounted the disk
    let diskOk = true;
    if (ex.disk) {
      const lk = await lookupDisk(client, cfg.app, ctx.secrets);
      diskOk = lk.ok && lk.mounted;
      table.push(`  ${diskOk ? "PASS" : "FAIL"}  ${"disk mounted".padEnd(48)} ${lk.ok ? (lk.mounted ? `${DISK_NAME}: mounts non-empty` : "mounts is empty: no release mounts the disk") : `disk lookup failed (${lk.error})`}`);
    } else {
      table.push(`  SKIP  ${"disk mounted".padEnd(48)} no disk in this release${releaseOnly ? " (--no-disk)" : ""}`);
    }
    ctx.out("probe results:");
    table.forEach((l) => ctx.out(l));
    const overall = anyPass && diskOk && !persistFail;
    ctx.out(`overall   : ${overall ? "PASS" : "FAIL"} (health 200 + status ok + sessionKey + dataDir writable on at least one URL${ex.disk ? " + disk mounted + data dir on the mounted disk when reported" : ""})`);

    // (g) spend log
    const after = await log(releaseOnly ? "release_only" : "deploy", { release: ex.releaseId, releaseState: done.state, probe: anyPass ? "PASS" : "FAIL", disk: ex.disk, ...(ex.disk ? { diskMounted: diskOk } : {}) });
    ctx.out(`${releaseOnly ? "step 3/3  " : "step 6/6  "}: spend log appended (${spendLog}); balance after ${after ?? "unknown"} toman`);
    ctx.out(`destroy   : ${SCRIPT} --destroy --yes --confirm-name ${cfg.app}`);
    if (releaseOnly) await printRealState(ctx, client, ex, overall);
    if (!overall) {
      if (!releaseOnly) printExisting(ctx, ex);
      return EXIT.liara;
    }
    return EXIT.ok;
  } catch (e) {
    const r = describeAny(e, ctx.secrets);
    deps.io.err(r.message);
    if (ex.app) {
      await log(releaseOnly ? "release_only_failed" : "deploy_failed", { error: r.message, release: ex.releaseId ?? null, releaseState: ex.releaseState ?? null }).catch(() => undefined);
    }
    if (releaseOnly) await printRealState(ctx, client, ex);
    else printExisting(ctx, ex);
    return r.exitCode === EXIT.ok ? EXIT.liara : r.exitCode;
  }
}

/* ------------------------------------------------------------------ destroy */

async function destroy(ctx: Ctx, yes: boolean): Promise<number> {
  const { deps, cfg } = ctx;
  if (yes) requireMutationsAllowed(deps.env);
  if (!hasToken(deps.env)) throw new GuardError("LIARA_API_TOKEN is not set (run with: npx tsx --env-file=.env scripts/deploy-self.ts)");
  const client = liaraFromEnv(deps.env, { fetchImpl: deps.fetchImpl });
  const before = await readBilling(client);
  if (!(await appExists(client, cfg.app))) {
    ctx.out(`app ${cfg.app} does not exist; nothing to delete`);
    return EXIT.ok;
  }
  const disks = (
    await listDisks(client, cfg.app).catch((e: unknown) => {
      ctx.out(`WARNING: the disks could not be listed (${describeError(e, ctx.secrets).message}); none will be deleted before the app`);
      return { disks: [] as Array<{ name?: string }> };
    })
  ).disks.flatMap((d) => (d.name ? [d.name] : []));
  if (!yes) {
    ctx.out("DRY RUN (destroy): nothing is changed. Re-run with --yes to delete.");
    ctx.out(`would delete: disks [${disks.join(", ") || "none"}] then app ${cfg.app} (permanent; data on the disk is lost)`);
    ctx.out(`balance now : ${before?.balance ?? "unknown"} toman (${before?.source ?? "?"})`);
    return EXIT.ok;
  }
  const spendLog = deps.spendLogPath ?? join(ctx.root, "scratch", "spend-log.jsonl");
  const now = deps.now ?? Date.now;
  const remaining: string[] = [];
  for (const disk of disks) {
    try {
      await executeAction(execCtx(client), { type: "delete_disk", app: cfg.app, disk }, { source: "user" });
      ctx.out(`deleted disk ${disk}`);
    } catch (e) {
      ctx.out(`WARNING: disk ${disk} not deleted (${describeAny(e, ctx.secrets).message}); deleting the app should remove it [VAL]`);
    }
  }
  let failure: unknown;
  try {
    await executeAction(execCtx(client), { type: "delete_app", app: cfg.app }, { source: "user" });
    ctx.out(`deleted app ${cfg.app}`);
  } catch (e) {
    failure = e;
  }
  const gone = !(await appExists(client, cfg.app).catch(() => true));
  if (!gone) remaining.push(`app ${cfg.app}`);
  const after = await readBilling(client);
  appendSpendLog(spendLog, {
    ts: new Date(now()).toISOString(),
    step: "destroy",
    app: cfg.app,
    account: cfg.teamMode ? "team" : "user",
    balanceBefore: before?.balance ?? null,
    balanceAfter: after?.balance ?? null,
    appGone: gone,
  }, ctx.secrets);
  ctx.out(`balance after: ${after?.balance ?? "unknown"} toman (before ${before?.balance ?? "unknown"}); spend log appended`);
  if (failure || remaining.length) {
    if (failure) deps.io.err(describeAny(failure, ctx.secrets).message);
    deps.io.err(`STILL EXISTS: ${remaining.join(", ") || "unknown (re-check in the console)"}`);
    return failure ? describeAny(failure, ctx.secrets).exitCode : EXIT.liara;
  }
  return EXIT.ok;
}

/* ------------------------------------------------------------------ entry */

/** Entry point of scripts/deploy-self.ts; returns the exit code and never throws. Output is redacted. */
export async function runDeploySelf(argv: readonly string[], deps: DeploySelfDeps): Promise<number> {
  const knownForErrors = envSecretValues(deps.env);
  try {
    const f = parseFlags(argv, { strings: ["confirm-name", "network", "create-network"], booleans: ["yes", "destroy", "help", "release-only", "no-disk"] });
    if (f.booleans.help) {
      deps.io.out(usage());
      return EXIT.ok;
    }
    const cfg = readConfig(deps.env);
    const network = f.strings.network;
    const createNetwork = f.strings["create-network"];
    const NET_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,62}$/;
    if (network !== undefined && !NET_RE.test(network)) throw new UsageError("--network must be a network name (3-63 chars: letters, digits, - and _)");
    if (createNetwork !== undefined && !NET_RE.test(createNetwork)) throw new UsageError("--create-network must be a network name (3-63 chars: letters, digits, - and _)");
    if (network !== undefined && createNetwork !== undefined) throw new UsageError("pass either --network or --create-network, not both");
    const netOpts: NetworkOpts = { ...(network !== undefined ? { network } : {}), ...(createNetwork !== undefined ? { createNetwork } : {}) };
    const root = deps.repoRoot ?? REPO_ROOT;
    const lj = readLiaraJson(root);

    const releaseOnly = f.booleans["release-only"];
    const noDisk = f.booleans["no-disk"];
    if (noDisk && !releaseOnly) throw new UsageError("--no-disk only applies to --release-only");
    if (releaseOnly && f.booleans.destroy) throw new UsageError("--release-only cannot be combined with --destroy");
    if (releaseOnly && (network !== undefined || createNetwork !== undefined)) throw new UsageError("--release-only cannot be combined with --network or --create-network (the app already exists)");

    if (f.booleans.destroy) {
      if (network || createNetwork) throw new UsageError("--network and --create-network do not apply to --destroy");
      const confirm = f.strings["confirm-name"];
      if (!confirm) throw new UsageError("--destroy requires --confirm-name <app name> (typed confirmation)");
      if (confirm !== cfg.app) throw new GuardError(`--confirm-name "${confirm}" does not match the app name "${cfg.app}"`);
      return await destroy(makeCtx(deps, cfg, lj, root), f.booleans.yes);
    }
    if (f.strings["confirm-name"] !== undefined) throw new UsageError("--confirm-name only applies to --destroy");

    if (f.booleans.yes) requireMutationsAllowed(deps.env);
    const ctx = makeCtx(deps, cfg, lj, root);
    const prepared = await prepareSource(root, ctx.secrets);
    if (releaseOnly) return f.booleans.yes ? await deploy(ctx, prepared, {}, true, noDisk) : await dryRunReleaseOnly(ctx, prepared, noDisk);
    return f.booleans.yes ? await deploy(ctx, prepared, netOpts) : await dryRun(ctx, prepared, netOpts);
  } catch (e) {
    const r = describeAny(e, knownForErrors);
    deps.io.err(r.message);
    if (r.exitCode === EXIT.usage) deps.io.err("\n" + usage());
    return r.exitCode;
  }
}

