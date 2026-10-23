import {
  applyEnvOps, createApp, createSourceArchive, deploySource, getApp, getEnvs, getMe, isLiaraError, listAppPlans, listNetworks, watchRelease,
  type EnvOp, type LiaraClient, type NormalizedPlan, type WatchOptions,
} from "../../lib/liara";
import { GuardError, parseFlags, UsageError, type ParsedFlags } from "./args";
import { billedAllowed, confirmBilled, EXIT, hasToken, liaraFromEnv, type Env } from "./guards";
import { describeError, redactLine } from "./output";
import { DEMO_ROOT, getScenario, readLiaraJson, readScenarioSources, type ScenarioEntry } from "./scenarios";

export type DemoMode = "seed" | "reset";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}
export interface DemoDeps {
  env: Env;
  io: Io;
  fetchImpl?: typeof fetch;
  /** Poll intervals/timeouts for the release watcher (tests shrink them). */
  watch?: WatchOptions;
  demoRoot?: string;
}

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SEP = "-".repeat(60);

export function usage(mode: DemoMode): string {
  const cmd = mode === "seed" ? "seed:demo" : "reset:demo";
  const lines =
    mode === "seed"
      ? [
          `npm run ${cmd} -- --scenario <id> --app <name> [--create --plan <planId> [--bundle <id>] [--network <name>]] [--yes]`,
          "",
          "  Deploys demo-app/<scenario> to a Liara app. DRY RUN by default: prints what it would do and changes nothing.",
          "  --yes      actually perform the steps (needs LIARA_API_TOKEN)",
          "  --create   create the app if it does not exist (BILLED; also needs ALLOW_BILLED_LIVE_TESTS=1)",
        ]
      : [
          `npm run ${cmd} -- --scenario <id> --app <name> [--yes]`,
          "",
          "  Re-applies a scenario to an EXISTING app (redeploy + env state) so a recording take starts from the exact state.",
          "  Use --scenario healthy to restore the good version. DRY RUN by default.",
        ];
  return [
    ...lines,
    "",
    "  Credentials come from the process environment only: LIARA_API_TOKEN, optional LIARA_TEAM_ID.",
    `  To load a .env file: npx tsx --env-file=.env scripts/${mode === "seed" ? "seed-demo" : "reset-demo"}.ts <flags>`,
    "  Exit codes: 0 ok, 1 usage, 2 refused by a guard, 3 Liara error.",
  ].join("\n");
}

interface Parsed {
  scenario: ScenarioEntry;
  app: string;
  yes: boolean;
  create: boolean;
  plan?: string;
  bundle?: string;
  network?: string;
}

function parseCommand(mode: DemoMode, argv: readonly string[], root: string): Parsed {
  const spec = mode === "seed"
    ? { strings: ["scenario", "app", "plan", "bundle", "network"], booleans: ["yes", "create", "help"] }
    : { strings: ["scenario", "app"], booleans: ["yes", "help"] };
  const f: ParsedFlags = parseFlags(argv, spec);
  if (f.booleans.help) throw new UsageError("help requested");
  const id = f.strings.scenario;
  const app = f.strings.app;
  if (!id) throw new UsageError("--scenario <id> is required");
  if (!app) throw new UsageError("--app <name> is required");
  if (!APP_NAME_RE.test(app)) throw new UsageError("--app must be 3-63 chars: lowercase letters, digits and hyphens");
  const create = f.booleans.create === true;
  const { plan, bundle, network } = f.strings;
  if (create && !plan) throw new UsageError("--create requires --plan <planId>");
  if (!create && (plan || bundle || network)) throw new UsageError("--plan/--bundle/--network only apply together with --create");
  return { scenario: getScenario(id, root), app, yes: f.booleans.yes === true, create, plan, bundle, network };
}

function cheapestBundle(plan: NormalizedPlan, wanted?: string) {
  const available = plan.bundles.filter((b) => b.available);
  if (wanted) return plan.bundles.find((b) => b.id === wanted && b.available);
  return [...available].sort((a, b) => (a.monthlyPrice ?? 0) - (b.monthlyPrice ?? 0))[0];
}

async function resolvePlan(client: LiaraClient, planId: string, bundleId?: string) {
  const plan = listAppPlans(await getMe(client)).find((p) => p.id === planId);
  if (!plan) throw new UsageError(`plan "${planId}" not found or not available for this account`);
  const bundle = cheapestBundle(plan, bundleId);
  if (!bundle) throw new UsageError(`no available bundle plan for "${planId}"${bundleId ? ` named "${bundleId}"` : ""}`);
  return { plan, bundle };
}

const costLine = (plan: NormalizedPlan, bundleMonthly = 0) =>
  `plan ${plan.id}: ${plan.pricePerHour}/hour (~${plan.pricePerMonth}/month) + bundle ~${bundleMonthly}/month (amounts as reported by Liara)`;

async function envOpsFor(client: LiaraClient, app: string, sc: ScenarioEntry): Promise<EnvOp[]> {
  const current = await getEnvs(client, app);
  const have = new Map(current.map((e) => [e.key, e.value]));
  const ops: EnvOp[] = [];
  for (const key of sc.envSetup.unset) if (have.has(key)) ops.push({ op: "unset", key });
  for (const [key, value] of Object.entries(sc.envSetup.set)) if (have.get(key) !== value) ops.push({ op: "set", key, value });
  return ops;
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

async function dryRun(mode: DemoMode, p: Parsed, deps: DemoDeps, archive: { fileCount: number; size: number }, port: number): Promise<void> {
  const { io, env } = deps;
  const sc = p.scenario;
  const envSteps = [
    ...sc.envSetup.unset.map((k) => `ensure env ${k} is UNSET (read -> merge -> full-list update-envs -> readback; restarts the app)`),
    ...Object.keys(sc.envSetup.set).map((k) => `ensure env ${k} is set to the scenario's broken value (value not shown)`),
  ];
  io.out(`DRY RUN (nothing is changed, no network is used for the plan). Re-run with --yes to execute.`);
  io.out(SEP);
  io.out(`command : ${mode}   scenario: ${sc.id} (v${sc.version})   app: ${p.app}`);
  io.out(`source  : demo-app/${sc.id} -> ${archive.fileCount} files, ${archive.size} bytes (.tar.gz, built in memory), release port ${port}`);
  const steps = [
    "check whether the app exists (GET)",
    ...(p.create ? [`create app ${p.app} (BILLED, POST /v1/projects)`] : [`${mode === "seed" ? "app must already exist (add --create to create it)" : "app must already exist"}`]),
    ...envSteps,
    "upload source and create a release (POST sources, POST releases)",
    "watch the release (build log + state) until it ends",
  ];
  steps.forEach((s, i) => io.out(`  ${i + 1}. ${s}`));
  io.out(`expected final release state: ${sc.acceptedReleaseStates.join(" | ")}`);
  if (p.create && !billedAllowed(p, env)) io.out("note: --create would be REFUSED: ALLOW_BILLED_LIVE_TESTS=1 is not set");
  if (!hasToken(env)) {
    io.out("offline: LIARA_API_TOKEN is not set, so app existence and prices were not looked up" + (p.create ? "; cost: unknown" : ""));
    return;
  }
  try {
    const client = liaraFromEnv(env, { fetchImpl: deps.fetchImpl });
    io.out(`lookup  : app ${p.app} ${(await appExists(client, p.app)) ? "exists" : "does not exist"}`);
    if (p.create && p.plan) {
      const { plan, bundle } = await resolvePlan(client, p.plan, p.bundle);
      io.out(`cost    : ${costLine(plan, bundle.monthlyPrice)} (bundle ${bundle.id})`);
    }
  } catch (e) {
    io.out(`lookup  : skipped (${describeError(e).message})`);
  }
}

async function execute(mode: DemoMode, p: Parsed, deps: DemoDeps, files: ReturnType<typeof readScenarioSources>, port: number, platform: string): Promise<number> {
  const { io, env } = deps;
  const sc = p.scenario;
  if (p.create) confirmBilled(p, env);
  const client = liaraFromEnv(env, { fetchImpl: deps.fetchImpl });

  io.out(`${mode}: scenario ${sc.id} (v${sc.version}) -> app ${p.app}`);
  if (!(await appExists(client, p.app))) {
    if (!p.create) throw new GuardError(`app "${p.app}" does not exist${mode === "seed" ? "; pass --create (billed) to create it" : "; use seed:demo --create first"}`);
    const { plan, bundle } = await resolvePlan(client, p.plan!, p.bundle);
    let network: string | undefined;
    if (p.network) {
      network = (await listNetworks(client)).find((n) => n.name === p.network)?._id;
      if (!network) throw new UsageError(`network "${p.network}" not found (create it in the console or the app UI first)`);
    }
    io.out(`creating app (BILLED): ${costLine(plan, bundle.monthlyPrice)}`);
    const created = await createApp(client, { name: p.app, planID: plan.id, bundlePlanID: bundle.id, platform: platform as "node", network });
    io.out(created ? `created: scale=${created.scale} isDeployed=${created.isDeployed}` : "created (details not readable yet)");
  } else {
    io.out("app exists: reusing it");
  }

  const ops = await envOpsFor(client, p.app, sc);
  if (ops.length) {
    const r = await applyEnvOps(client, p.app, ops);
    io.out(`env: ${ops.map((o) => `${o.op} ${o.key}`).join(", ")} (values hidden); readback ${r.verified ? "verified" : "MISMATCH"}`);
    if (!r.verified) throw new Error(`env readback mismatch (missing: ${r.missingAfter.join(",") || "-"}; still present: ${r.unexpectedAfter.join(",") || "-"})`);
  } else {
    io.out("env: already in the scenario's state (no change)");
  }

  const dep = await deploySource(client, p.app, { files }, { port, type: platform, message: `hamyar demo ${sc.id} v${sc.version}` });
  io.out(`uploaded ${dep.archive.fileCount} files (${dep.archive.size} bytes); release ${dep.releaseID} created`);

  let state = "UNKNOWN";
  let ok = false;
  for await (const ev of watchRelease(client, dep.releaseID, deps.watch)) {
    if (ev.kind === "state") io.out(`state: ${ev.state}${ev.queue ? ` (queue ${ev.queue})` : ""}`);
    else if (ev.kind === "log") io.out(`  build ${ev.stream === "STDERR" ? "err" : "out"}| ${redactLine(ev.line)}`);
    else {
      state = ev.state;
      ok = ev.ok;
      io.out(`done: ${ev.state}${ev.failReason ? ` (${redactLine(ev.failReason)})` : ""}${ev.reason ? ` [${ev.reason}]` : ""}`);
    }
  }
  const detail = await getApp(client, p.app).catch(() => undefined);
  if (detail?.defaultSubdomain !== false) io.out(`url: https://${p.app}.liara.run (verified live 2026-10-23)`);
  io.out(`final release state: ${state}`);
  if (ok || sc.acceptedReleaseStates.includes(state)) return EXIT.ok;
  io.err(`release ended ${state}, expected ${sc.acceptedReleaseStates.join(" | ")}`);
  return EXIT.liara;
}

/** Entry point shared by seed-demo.ts and reset-demo.ts; returns the process exit code and never throws. */
export async function runDemoCommand(mode: DemoMode, argv: readonly string[], deps: DemoDeps): Promise<number> {
  try {
    const root = deps.demoRoot ?? DEMO_ROOT;
    const p = parseCommand(mode, argv, root);
    const files = readScenarioSources(p.scenario.id, p.app, root);
    const lj = readLiaraJson(p.scenario.id, root);
    if (!p.yes) {
      const archive = await createSourceArchive({ files });
      await dryRun(mode, p, deps, archive, lj.port);
      return EXIT.ok;
    }
    return await execute(mode, p, deps, files, lj.port, lj.platform);
  } catch (e) {
    const r = describeError(e);
    deps.io.err(r.message);
    if (r.exitCode === EXIT.usage) deps.io.err("\n" + usage(mode));
    return r.exitCode;
  }
}
