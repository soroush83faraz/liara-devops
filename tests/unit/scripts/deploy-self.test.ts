// deploy-self against the SYNTHETIC FakeLiara (behind the real client): no live Liara call, no real money.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectSource, ENV_NAMES, findDanglingConfigs, prepareSource, REPO_ROOT, runDeploySelf, scanArchiveFiles, uploadIgnore, type DeploySelfDeps,
} from "../../../scripts/lib/deploy-self";
import { FakeLiara, fakeClock } from "../actions/fake-liara";
import { collectIo } from "./fake-liara";

const TOKEN = "SYNTH-liara-token-ABCDEF1234567890";
const TEAM = "team_SYNTH_0001";
const APP = "hamyar-liara";

const ME = {
  user: { _id: "u1", email: "user@example.invalid", isTeam: false },
  team: { _id: TEAM, isTeam: true, teamName: "SYNTH team", teamMemberRole: "owner", balance: 100_000 },
  plans: {
    projects: {
      free: { available: false, price: 0 },
      "mini-g2": { available: false, price: 381.94 },
      "small-g2": { available: true, RAM: { amount: 0.5 }, CPU: { amount: 0.5 }, volume: 5, price: 659.72 },
      "medium-g2": { available: true, RAM: { amount: 1 }, price: 1145.83 },
    },
    projectBundlePlans: {
      "small-g2": { basic: { available: true, displayPrice: 275_000 }, standard: { available: true, displayPrice: 475_000 } },
      "medium-g2": { basic: { available: true, displayPrice: 300_000 } },
    },
  },
};
const TEAM_BILLING = (teamBalance: number) => ({ user: { balance: 0.6 }, team: { balance: teamBalance, minCreditAmount: 0 } });

function makeLiara(over: { billing?: unknown; me?: unknown; networks?: Array<{ _id: string; name: string }> } = {}) {
  const fake = new FakeLiara(fakeClock());
  fake.networks = over.networks ?? [{ _id: "net_main", name: "main" }]; // g2 plans need a private network: exactly one by default
  fake.me = over.me ?? ME;
  fake.billingBody = over.billing ?? TEAM_BILLING(100_000);
  return fake;
}

const HEALTH = { status: "ok", version: "0.1.0", uptimeSec: 3, checks: { sessionKey: true, dataDir: "writable", llmConfigured: false } };
function probeFetch(probed: string[], health: unknown = HEALTH): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    probed.push(url);
    if (url.endsWith("/api/health")) {
      return new Response(JSON.stringify(health), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "strict-transport-security": "max-age=63072000" } });
    }
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
}

const baseEnv = { LIARA_API_TOKEN: TOKEN, LIARA_TEAM_ID: TEAM };
const billedEnv = { ...baseEnv, ALLOW_BILLED_LIVE_TESTS: "1" };

function deps(fake: FakeLiara, env: Record<string, string>, extra: Partial<DeploySelfDeps> = {}) {
  const io = collectIo();
  const spendLogPath = join(mkdtempSync(join(tmpdir(), "deploy-self-")), "spend-log.jsonl");
  const probed: string[] = [];
  const d: DeploySelfDeps = {
    env,
    io: io.io,
    fetchImpl: fake.fetchImpl,
    probeFetch: probeFetch(probed),
    watch: { queueIntervalMs: 0, logIntervalMs: 0, timeoutMs: 5_000 },
    probe: { attempts: 1, intervalMs: 0, timeoutMs: 1_000 },
    sleep: async () => undefined,
    spendLogPath,
    ...extra,
  };
  return { d, io, spendLogPath, probed };
}

const mutating = (fake: FakeLiara) => fake.mutations().map((c) => `${c.method} ${c.path}`);

describe("deploy-self: dry run", () => {
  it("is the default, sends GETs only and prints team account, team balance, plan, cost, disk, env NAMES, files and steps", async () => {
    const fake = makeLiara();
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf([], d)).toBe(0);
    expect(fake.mutations()).toEqual([]);
    expect(fake.calls.length).toBeGreaterThan(0);
    const text = io.text();
    expect(text).toContain("DRY RUN");
    expect(text).toContain('team "SYNTH team"');
    expect(text).toContain("100000 toman (team wallet)"); // team.balance, never the personal 0.6
    expect(text).toContain("small-g2 (preferred small-g2");
    expect(text).toContain("659.72 toman/hour");
    expect(text).toContain("basic 275000 toman/month");
    expect(text).toContain("(verified live 2026-10-23: additive to the plan price)");
    expect(text).toContain("1145.83 toman/hour (plan + bundle + disk)");
    expect(text).toContain("6875.01 toman for 6 hours; balance required 20625.02 (3x)"); // includes the disk
    expect(text).toContain("data 1 GB: 104.17 toman/hour (INFERRED live 2026-10-23");
    expect(text).toContain("network   : main (existing; the only private network on the account, used automatically");
    expect(text).toContain("network main");
    expect(text).toContain("DATA_DIR=./data");
    for (const k of ENV_NAMES) expect(text).toContain(k);
    expect(text).toMatch(/source {4}: \d+ files, \d+ bytes -> \d+ bytes \.tar\.gz/);
    expect(text).toContain("secret scan: clean");
    expect(text).toContain("9. append the spend log line");
    expect(text).not.toContain(TOKEN);
  });

  it("works offline without a token: no fetch at all, cost unknown", async () => {
    const fake = makeLiara();
    const { d, io } = deps(fake, {});
    expect(await runDeploySelf([], d)).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(io.text()).toContain("offline");
    expect(io.text()).toContain("would be REFUSED: ALLOW_BILLED_LIVE_TESTS=1 is not set");
  });

  it("--help exits 0 offline", async () => {
    const fake = makeLiara();
    const { d, io } = deps(fake, {});
    expect(await runDeploySelf(["--help"], d)).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(io.text()).toContain("--destroy --confirm-name");
  });

  it("refuses (exit 2) when no available non-free plan has a known price (assertPriced)", async () => {
    const me = { ...ME, plans: { projects: { "small-g2": { available: true }, "mini-g2": { available: false, price: 381 } }, projectBundlePlans: {} } };
    const fake = makeLiara({ me });
    const { d, io } = deps(fake, baseEnv);
    expect(await runDeploySelf([], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.text()).toContain("assertPriced");
  });

  it("falls back to the cheapest priced plan when small-g2 is unavailable", async () => {
    const me = { ...ME, plans: { ...ME.plans, projects: { ...ME.plans.projects, "small-g2": { available: false, price: 659.72 } } } };
    const fake = makeLiara({ me });
    const { d, io } = deps(fake, baseEnv);
    expect(await runDeploySelf([], d)).toBe(0);
    expect(io.text()).toContain("medium-g2 (small-g2 not available; cheapest priced plan");
  });
});

describe("deploy-self: --yes guards (nothing billed unless every check passes)", () => {
  it("refuses without ALLOW_BILLED_LIVE_TESTS=1 before any call", async () => {
    const fake = makeLiara();
    const { d, io } = deps(fake, baseEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(2);
    expect(fake.calls).toEqual([]);
    expect(io.text()).toContain("ALLOW_BILLED_LIVE_TESTS=1");
  });

  it("refuses when the team balance is unreadable (no `team` in billing): personal balance is never a stand-in", async () => {
    const fake = makeLiara({ billing: { user: { balance: 10_000_000 } } });
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.text()).toContain("team balance is unreadable");
  });

  it("refuses when the team balance is below 3x the projected 6h cost", async () => {
    const fake = makeLiara({ billing: TEAM_BILLING(18_000) });
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.text()).toContain("below 3x the projected 6h cost");
  });

  it("the 3x balance gate includes the disk: 19000 covers 3x plan+bundle (18749.97) but not 3x with the disk (20625.02)", async () => {
    const fake = makeLiara({ billing: TEAM_BILLING(19_000) });
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.text()).toContain("below 3x the projected 6h cost (20625.02)");
  });

  it("refuses when the projected cost exceeds SPEND_CAP_TOMAN", async () => {
    const fake = makeLiara();
    const { d, io } = deps(fake, { ...billedEnv, SPEND_CAP_TOMAN: "5000" });
    expect(await runDeploySelf(["--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.text()).toContain("exceeds SPEND_CAP_TOMAN");
  });

  it("refuses to reuse an existing app", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    const { d } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
  });
});

describe("deploy-self: --yes flow", () => {
  it("creates app, disk, env, uploads, releases, watches, probes, logs spend; never prints a value", async () => {
    const fake = makeLiara();
    const { d, io, spendLogPath, probed } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(0);

    expect(mutating(fake)).toEqual([
      "POST /v1/projects",
      `POST /v1/projects/${APP}/disks`,
      "POST /v1/projects/update-envs",
      `POST /v2/projects/${APP}/sources`,
      `POST /v2/projects/${APP}/releases`,
    ]);
    const body = (path: string) => fake.calls.find((c) => c.method === "POST" && c.path === path)!.body as Record<string, unknown>;
    expect(body("/v1/projects")).toMatchObject({ name: APP, planID: "small-g2", bundlePlanID: "basic", platform: "next" });
    expect(body("/v1/projects")).toMatchObject({ network: "net_main" }); // the only network was used automatically
    expect(io.text()).toContain("the only private network on the account");
    expect(body(`/v1/projects/${APP}/disks`)).toEqual({ name: "data", size: "1" });
    expect(body(`/v2/projects/${APP}/releases`)).toMatchObject({ port: 3000, type: "next", disks: [{ name: "data", mountTo: "data" }], platformConfig: { nodeVersion: "22" } });
    expect(body(`/v2/projects/${APP}/releases`)).not.toHaveProperty("healthCheck");

    const vars = (body("/v1/projects/update-envs").variables as Array<{ key: string; value: string }>);
    expect(vars.map((v) => v.key)).toEqual([...ENV_NAMES]);
    const val = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    expect(Buffer.from(val.APP_SESSION_KEY, "base64")).toHaveLength(48);
    expect(Buffer.from(val.APP_APPROVAL_KEY, "base64")).toHaveLength(48);
    expect(val.APP_SESSION_KEY).not.toBe(val.APP_APPROVAL_KEY);
    expect(val.TRUSTED_PROXY_HOPS).toBe("1");
    expect(val.DATA_DIR).toBe("./data");

    const text = io.text();
    for (const k of ENV_NAMES) expect(text).toContain(k);
    expect(text).not.toContain(val.APP_SESSION_KEY);
    expect(text).not.toContain(val.APP_APPROVAL_KEY);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("release   : READY");
    expect(text).toContain("overall   : PASS");
    expect(text).toMatch(/PASS {2}cache-control no-store/);
    expect(probed[0]).toBe(`https://${APP}.liara.run/api/health`);
    expect(probed.some((u) => u.includes("iran.liara.run"))).toBe(false); // that host form does not exist
    expect(probed.filter((u) => u.endsWith("/api/health"))).toEqual([`https://${APP}.liara.run/api/health`]);
    expect(io.text()).toMatch(/SKIP {2}data dir on mounted disk/); // an older build does not report the field

    const log = readFileSync(spendLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(log.map((l) => l.step)).toEqual(["create_app", "deploy"]);
    expect(log[1]).toMatchObject({ plan: "small-g2", hourlyToman: 1145.83, balanceBefore: 100_000, account: "team", releaseState: "READY", probe: "PASS" });
    const raw = readFileSync(spendLogPath, "utf8");
    expect(raw).not.toContain(val.APP_SESSION_KEY);
    expect(raw).not.toContain(TOKEN);
  });

  it("a refused disk create continues without a disk (no disks in the release body)", async () => {
    const fake = makeLiara();
    fake.fault(`POST /v1/projects/${APP}/disks`, { status: 400, json: { message: "disk not allowed" } });
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(0);
    const rel = fake.calls.find((c) => c.method === "POST" && c.path === `/v2/projects/${APP}/releases`)!.body as Record<string, unknown>;
    expect(rel).not.toHaveProperty("disks");
    expect(io.text()).toContain("continuing WITHOUT a disk");
  });

  it("a failed release is not retried: exit 3, prints what exists and the cleanup command", async () => {
    const fake = makeLiara();
    fake.releaseFinalState = "FAILED";
    const { d, io, spendLogPath } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(3);
    expect(mutating(fake).filter((c) => c === "POST /v1/projects")).toHaveLength(1);
    expect(mutating(fake).filter((c) => c.endsWith("/releases"))).toHaveLength(1);
    const err = io.err.join("\n");
    expect(err).toContain("RESOURCES THAT EXIST NOW");
    expect(err).toContain(`app ${APP}: CREATED`);
    expect(err).toContain(`--destroy --yes --confirm-name ${APP}`);
    expect(readFileSync(spendLogPath, "utf8")).toContain('"step":"deploy_failed"');
  });

  it("a FAILED release prints the last 15 redacted STDERR build lines and the failReason, plus the cleanup hint", async () => {
    const fake = makeLiara();
    fake.releaseFinalState = "FAILED";
    fake.releaseFailReason = "build command exited with 1";
    fake.buildOutput = [
      { line: "npm ci done", stream: "STDOUT" },
      ...Array.from({ length: 20 }, (_, i) => ({ line: `type error ${i + 1}`, stream: "STDERR" as const })),
      { line: `token leaked ${TOKEN}`, stream: "STDERR" },
    ];
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(3);
    const err = io.err.join("\n");
    expect(err).toContain("failReason build command exited with 1");
    expect(err).toContain("last 15 build STDERR lines");
    expect(err).toContain("type error 20");
    expect(err).not.toContain("type error 6");
    expect(err).not.toContain("type error 1\n");
    expect(err).not.toContain(TOKEN);
    expect(err).toContain("RESOURCES THAT EXIST NOW");
    expect(err).toContain(`--destroy --yes --confirm-name ${APP}`);
  });

  it("data dir on mounted disk: PASS when mounted, FAIL (and overall FAIL) when not_mounted, SKIP when unknown", async () => {
    const withPersistence = (dataDirPersistent: string, status = "ok") => ({ ...HEALTH, status, checks: { ...HEALTH.checks, dataDirPersistent } });
    const run = async (health: unknown) => {
      const fake = makeLiara();
      const { d, io } = deps(fake, billedEnv);
      d.probeFetch = probeFetch([], health);
      const code = await runDeploySelf(["--yes"], d);
      return { code, text: io.text() };
    };
    const mounted = await run(withPersistence("mounted"));
    expect(mounted.code).toBe(0);
    expect(mounted.text).toMatch(/PASS {2}data dir on mounted disk/);
    const notMounted = await run(withPersistence("not_mounted", "degraded"));
    expect(notMounted.code).toBe(3);
    expect(notMounted.text).toMatch(/FAIL {2}data dir on mounted disk +not_mounted/);
    expect(notMounted.text).toContain("overall   : FAIL");
    const unknown = await run(withPersistence("unknown"));
    expect(unknown.code).toBe(0);
    expect(unknown.text).toMatch(/SKIP {2}data dir on mounted disk/);
  });

  it("a failing health probe exits 3 with a FAIL table", async () => {
    const fake = makeLiara();
    const { d, io } = deps(fake, billedEnv);
    const probed: string[] = [];
    d.probeFetch = probeFetch(probed, { status: "unavailable", checks: { sessionKey: false, dataDir: "missing" } });
    expect(await runDeploySelf(["--yes"], d)).toBe(3);
    expect(io.text()).toContain("overall   : FAIL");
    expect(io.text()).toMatch(/FAIL {2}checks\.sessionKey is true/);
  });
});

describe("deploy-self: private network (g2 plans need one)", () => {
  const netCreateCalls = (fake: FakeLiara) => fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/networks");

  it("dry run with no network: refuses clearly (exit 0, GETs only) and prints the exact create command and --create-network", async () => {
    const fake = makeLiara({ networks: [] });
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf([], d)).toBe(0);
    expect(fake.mutations()).toEqual([]);
    const text = io.text();
    expect(text).toContain("network   : REFUSED: no private network exists");
    expect(text).toContain("403 g2_plan_unavailable");
    expect(text).toContain('-X POST "https://api.liara.ir/v1/networks?teamID=<team id>"');
    expect(text).toContain('{"networkName":"hamyar-net"}');
    expect(text).toContain("--yes --create-network hamyar-net");
    expect(text).toContain("--yes would be REFUSED: no usable private network");
    expect(text).not.toContain(TOKEN);
  });

  it("dry run with several networks asks for --network; with --network or --create-network it does not list-refuse", async () => {
    const two = [{ _id: "a", name: "net-a" }, { _id: "b", name: "net-b" }];
    const f1 = makeLiara({ networks: two });
    const r1 = deps(f1, billedEnv);
    expect(await runDeploySelf([], r1.d)).toBe(0);
    expect(r1.io.text()).toContain("2 private networks exist (net-a, net-b); pass --network <name>");
    const f2 = makeLiara({ networks: two });
    const r2 = deps(f2, billedEnv);
    expect(await runDeploySelf(["--network", "net-b"], r2.d)).toBe(0);
    expect(r2.io.text()).toContain("network   : net-b (existing; from --network)");
    const f3 = makeLiara({ networks: [] });
    const r3 = deps(f3, billedEnv);
    expect(await runDeploySelf(["--create-network", "hamyar-net"], r3.d)).toBe(0);
    expect(r3.io.text()).toContain("network   : hamyar-net (to be created;");
    expect(r3.io.text()).toContain("create the private network hamyar-net first");
    expect(f3.mutations()).toEqual([]);
  });

  it("--yes with no network is refused (exit 2) before anything billed or created", async () => {
    const fake = makeLiara({ networks: [] });
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.text()).toContain("no private network exists");
    expect(io.text()).toContain("--create-network hamyar-net");
  });

  it("--yes with several networks and no --network is refused; --network picks one", async () => {
    const two = [{ _id: "a", name: "net-a" }, { _id: "b", name: "net-b" }];
    const f1 = makeLiara({ networks: two });
    expect(await runDeploySelf(["--yes"], deps(f1, billedEnv).d)).toBe(2);
    expect(f1.mutations()).toEqual([]);
    const f2 = makeLiara({ networks: two });
    expect(await runDeploySelf(["--yes", "--network", "net-b"], deps(f2, billedEnv).d)).toBe(0);
    expect(f2.calls.find((c) => c.method === "POST" && c.path === "/v1/projects")!.body).toMatchObject({ network: "b" });
    expect(netCreateCalls(f2)).toHaveLength(0);
  });

  it("--yes --create-network creates the free network first, then the app with it", async () => {
    const fake = makeLiara({ networks: [] });
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--yes", "--create-network", "hamyar-net"], d)).toBe(0);
    expect(mutating(fake).slice(0, 2)).toEqual(["POST /v1/networks", "POST /v1/projects"]);
    expect(netCreateCalls(fake)[0].body).toEqual({ networkName: "hamyar-net" });
    const created = fake.networks.find((n) => n.name === "hamyar-net")!;
    expect(fake.calls.find((c) => c.method === "POST" && c.path === "/v1/projects")!.body).toMatchObject({ network: created._id });
    expect(io.text()).toContain("private network hamyar-net created (free)");
  });

  it("--create-network of an existing network just uses it (no POST /v1/networks)", async () => {
    const fake = makeLiara();
    expect(await runDeploySelf(["--yes", "--create-network", "main"], deps(fake, billedEnv).d)).toBe(0);
    expect(netCreateCalls(fake)).toHaveLength(0);
    expect(fake.calls.find((c) => c.method === "POST" && c.path === "/v1/projects")!.body).toMatchObject({ network: "net_main" });
  });

  it("usage errors: both flags together, a too-short name, --create-network with --release-only or --destroy", async () => {
    const fake = makeLiara();
    expect(await runDeploySelf(["--network", "abc", "--create-network", "abd"], deps(fake, billedEnv).d)).toBe(1);
    expect(await runDeploySelf(["--create-network", "ab"], deps(fake, billedEnv).d)).toBe(1);
    expect(await runDeploySelf(["--release-only", "--create-network", "abc"], deps(fake, billedEnv).d)).toBe(1);
    expect(await runDeploySelf(["--destroy", "--confirm-name", APP, "--create-network", "abc"], deps(fake, billedEnv).d)).toBe(1);
    expect(fake.calls).toEqual([]);
  });
});

describe("deploy-self: --release-only (existing app)", () => {
  const releaseMutations = [`POST /v2/projects/${APP}/sources`, `POST /v2/projects/${APP}/releases`];
  const relBody = (fake: FakeLiara) => fake.calls.find((c) => c.method === "POST" && c.path === `/v2/projects/${APP}/releases`)!.body as Record<string, unknown>;

  it("only uploads and releases: no create_app, no disk POST, no update-envs, no plan or balance gating; logs release_only", async () => {
    const fake = makeLiara({ billing: { user: { balance: 1 } } }); // unreadable/low team balance must not matter
    fake.addApp(APP);
    fake.disks.set(APP, [{ name: "data" }]);
    const { d, io, spendLogPath, probed } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(0);
    expect(mutating(fake)).toEqual(releaseMutations);
    expect(fake.calls.some((c) => c.path === "/v1/me")).toBe(false);
    expect(relBody(fake)).toMatchObject({ port: 3000, type: "next", disks: [{ name: "data", mountTo: "data" }], platformConfig: { nodeVersion: "22" } });
    expect(relBody(fake)).not.toHaveProperty("healthCheck");
    const text = io.text();
    expect(text).toContain("release   : READY");
    expect(text).toContain("overall   : PASS");
    expect(probed[0]).toBe(`https://${APP}.liara.run/api/health`);
    expect(text).not.toContain(TOKEN);
    const log = readFileSync(spendLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(log.map((l) => l.step)).toEqual(["release_only"]);
    expect(log[0]).toMatchObject({ releaseState: "READY", probe: "PASS", disk: true, diskMounted: true, plan: null });
    // disk lookups go by the project _id (by name the disk list is a 500 live): before the release, after it, and in the final state
    const diskGets = fake.calls.filter((c) => c.method === "GET" && c.path.endsWith("/disks")).map((c) => c.path);
    expect(diskGets.length).toBeGreaterThanOrEqual(2);
    expect(new Set(diskGets)).toEqual(new Set([`/v1/projects/id_${APP}/disks`]));
    expect(text).toContain(`CURRENT STATE OF ${APP}`);
    expect(text).toMatch(/PASS {2}disk mounted/);
    expect(text).toContain("overall   : PASS");
  });

  it("reads the real final state (app detail, disks by id, env var NAMES) instead of what the run did", async () => {
    const fake = makeLiara();
    fake.addApp(APP, { envs: [{ key: "APP_SESSION_KEY", value: "SYNTH-secret-value-1" }, { key: "DATA_DIR", value: "./data" }] });
    fake.disks.set(APP, [{ name: "data" }]);
    fake.releaseFinalState = "FAILED"; // the failure report is where the real-state summary is printed
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(3);
    const err = io.err.join("\n");
    expect(err).toContain(`CURRENT STATE OF ${APP}`);
    expect(err).toContain("env vars (names only): APP_SESSION_KEY, DATA_DIR");
    expect(err).toContain("disk data: exists; mounted by a release");
    expect(err).not.toContain("SYNTH-secret-value-1");
    expect(err).not.toContain("disk: not created");
    expect(err).not.toContain("none set");
  });

  it("FAIL line 'disk mounted' (and a non-zero exit) when the disk exists but no release mounts it", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    fake.disks.set(APP, [{ name: "data" }]);
    const realFetch = fake.fetchImpl;
    // Liara accepted the release but the disks listing still shows `mounts: []`
    const noMounts = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await realFetch(input, init);
      if ((init?.method ?? "GET") === "GET" && new URL(String(input)).pathname.endsWith("/disks")) {
        return new Response(JSON.stringify({ disks: [{ name: "data", size: 1 }], mounts: [] }), { status: 200 });
      }
      return res;
    }) as typeof fetch;
    const { d, io } = deps(fake, billedEnv, { fetchImpl: noMounts });
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(3);
    expect(io.text()).toMatch(/FAIL {2}disk mounted/);
    expect(io.text()).toContain("overall   : FAIL");
    expect(io.err.join("\n")).toContain("NOT mounted by any release");
  });

  it("REFUSES (exit 2, no mutation) when the app has no disk named data", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.err.join("\n")).toContain("disk data was not found");
    expect(io.err.join("\n")).toContain("--no-disk");
  });

  it("REFUSES when the disk lookup itself fails (live: by-name listing is a 500); it is not treated as 'no disk'", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    fake.disks.set(APP, [{ name: "data" }]);
    fake.fault(`GET /v1/projects/id_${APP}/disks`, { status: 500, json: { error: "Internal Server Error" } });
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.err.join("\n")).toContain("could not look up the disks");
  });

  it("--no-disk releases without disks (explicit opt-out), with SKIP 'disk mounted' and a warning", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only", "--yes", "--no-disk"], d)).toBe(0);
    expect(mutating(fake)).toEqual(releaseMutations);
    expect(relBody(fake)).not.toHaveProperty("disks");
    expect(io.text()).toContain("--no-disk");
    expect(io.text()).toMatch(/SKIP {2}disk mounted/);
  });

  it("--no-disk also bypasses a failed disk lookup; it is rejected without --release-only", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    fake.fault(`GET /v1/projects/id_${APP}/disks`, { status: 500, json: { error: "Internal Server Error" } });
    expect(await runDeploySelf(["--release-only", "--yes", "--no-disk"], deps(fake, billedEnv).d)).toBe(0);
    expect(relBody(fake)).not.toHaveProperty("disks");
    const other = makeLiara();
    expect(await runDeploySelf(["--yes", "--no-disk"], deps(other, billedEnv).d)).toBe(1);
    expect(other.calls).toEqual([]);
  });

  it("a FakeLiara by-name disk listing answers 500 like live (so a name-based lookup could never pass these tests)", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    const res = await fake.fetchImpl(`https://api.liara.ir/v1/projects/${APP}/disks`);
    expect(res.status).toBe(500);
    expect((await fake.fetchImpl(`https://api.liara.ir/v1/projects/id_${APP}/disks`)).status).toBe(200);
  });

  it("refuses with a clear message when the app does not exist (no mutation)", async () => {
    const fake = makeLiara();
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(2);
    expect(fake.mutations()).toEqual([]);
    expect(io.err.join("\n")).toContain(`app ${APP} does not exist; --release-only needs an existing app`);
  });

  it("refuses without ALLOW_BILLED_LIVE_TESTS=1 before any call", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    const { d, io } = deps(fake, baseEnv);
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(2);
    expect(fake.calls).toEqual([]);
    expect(io.text()).toContain("ALLOW_BILLED_LIVE_TESTS=1");
  });

  it("refuses --network and --destroy combos before any call", async () => {
    const fake = makeLiara();
    expect(await runDeploySelf(["--release-only", "--yes", "--network", "hamyar-net"], deps(fake, billedEnv).d)).toBe(1);
    expect(await runDeploySelf(["--release-only", "--destroy", "--yes", "--confirm-name", APP], deps(fake, billedEnv).d)).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it("dry run (no --yes) reads the app and disks with GETs only and lists the release-only steps", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    fake.disks.set(APP, [{ name: "data" }]);
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only"], d)).toBe(0);
    expect(fake.mutations()).toEqual([]);
    const text = io.text();
    expect(text).toContain("DRY RUN (--release-only)");
    expect(text).toContain(`app ${APP} exists`);
    expect(text).toContain("release_only");
    expect(text).toContain("secret scan: clean");
    expect(text).toContain("disk      : data exists");
  });

  it("dry run says --yes would REFUSE when the disk is missing, and what --no-disk does", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    const a = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only"], a.d)).toBe(0);
    expect(a.io.text()).toContain("would REFUSE");
    const b = deps(fake, billedEnv);
    expect(await runDeploySelf(["--release-only", "--no-disk"], b.d)).toBe(0);
    expect(b.io.text()).toContain("--no-disk: the release would carry no disks");
    expect(fake.mutations()).toEqual([]);
  });

  it("the secret scan still applies: a planted secret file in the source stops it before any Liara call", async () => {
    const root = mkdtempSync(join(tmpdir(), "deploy-self-src-"));
    for (const f of ["liara.json", "package.json", "package-lock.json", ".liaraignore"]) cpSync(join(REPO_ROOT, f), join(root, f));
    writeFileSync(join(root, "leak.ts"), `export const t = "${TOKEN}";\n`);
    const fake = makeLiara();
    fake.addApp(APP);
    const { d, io } = deps(fake, billedEnv, { repoRoot: root });
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(2);
    expect(fake.calls).toEqual([]);
    expect(io.text()).toContain("leak.ts: contains the value of a secret env variable");
    expect(io.text()).not.toContain(TOKEN);
  });

  it("a root config importing an ignored directory refuses the upload (regression: next build type-checked playwright.config.ts)", async () => {
    const root = mkdtempSync(join(tmpdir(), "deploy-self-src-"));
    for (const f of ["liara.json", "package.json", "package-lock.json"]) cpSync(join(REPO_ROOT, f), join(root, f));
    writeFileSync(join(root, ".liaraignore"), "tests\nnode_modules\n");
    writeFileSync(join(root, "vitest.config.ts"), 'import { setup } from "./tests/setup";\nexport default { setup };\n');
    const fake = makeLiara();
    fake.addApp(APP);
    const { d, io } = deps(fake, billedEnv, { repoRoot: root });
    expect(await runDeploySelf(["--release-only", "--yes"], d)).toBe(2);
    expect(fake.calls).toEqual([]);
    expect(io.text()).toContain("vitest.config.ts: test config uploaded but tests/ is not");
    expect(io.text()).toContain("vitest.config.ts: imports ./tests");
  });
});

describe("deploy-self: --destroy", () => {
  it("requires --confirm-name (usage, exit 1) matching the app (guard, exit 2), before any call", async () => {
    const fake = makeLiara();
    expect(await runDeploySelf(["--destroy", "--yes"], deps(fake, billedEnv).d)).toBe(1);
    expect(await runDeploySelf(["--destroy", "--yes", "--confirm-name", "other-app"], deps(fake, billedEnv).d)).toBe(2);
    expect(await runDeploySelf(["--confirm-name", APP], deps(fake, billedEnv).d)).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it("refuses without ALLOW_BILLED_LIVE_TESTS=1", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    expect(await runDeploySelf(["--destroy", "--yes", "--confirm-name", APP], deps(fake, baseEnv).d)).toBe(2);
    expect(fake.calls).toEqual([]);
  });

  it("without --yes only reads", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    fake.disks.set(APP, [{ name: "data" }]);
    const { d, io } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--destroy", "--confirm-name", APP], d)).toBe(0);
    expect(fake.mutations()).toEqual([]);
    expect(io.text()).toContain("would delete: disks [data] then app hamyar-liara");
  });

  it("deletes the disk then the app through the typed delete executors, reports balance after and logs spend", async () => {
    const fake = makeLiara();
    fake.addApp(APP);
    fake.disks.set(APP, [{ name: "data" }]);
    const { d, io, spendLogPath } = deps(fake, billedEnv);
    expect(await runDeploySelf(["--destroy", "--yes", "--confirm-name", APP], d)).toBe(0);
    expect(mutating(fake)).toEqual([`DELETE /v1/projects/id_${APP}/disks/data`, `DELETE /v1/projects/${APP}`]);
    expect(fake.apps.has(APP)).toBe(false);
    expect(io.text()).toContain("balance after: 100000 toman");
    expect(JSON.parse(readFileSync(spendLogPath, "utf8").trim())).toMatchObject({ step: "destroy", appGone: true, balanceAfter: 100_000 });
  });
});

describe("deploy-self: upload contents (real repo root)", () => {
  it("applies .liaraignore: no .env*, node_modules, .next, tests, scripts, data; keeps liara.json and the lockfile", () => {
    const { files } = collectSource(REPO_ROOT);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("liara.json");
    expect(paths).toContain("package.json");
    expect(paths).toContain("package-lock.json");
    expect(paths).toContain("app/api/health/route.ts");
    const banned = /(^|\/)\.env(\.|$)|^node_modules\/|^\.next\/|^tests\/|^scripts\/|^demo-app\/|^docs\/|^data\/|^scratch\/|^\.git\/|\.zip$/;
    expect(paths.filter((p) => banned.test(p))).toEqual([]);
    expect(scanArchiveFiles(files, [TOKEN])).toEqual([]);
  });

  it("the real archive has no test configs (tests/ is ignored) and no root config importing a missing directory", async () => {
    const { files } = collectSource(REPO_ROOT);
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.startsWith("tests/"))).toBe(false);
    expect(paths).not.toContain("playwright.config.ts");
    expect(paths).not.toContain("vitest.config.ts");
    expect(findDanglingConfigs(files)).toEqual([]);
    await expect(prepareSource(REPO_ROOT, [TOKEN])).resolves.toBeDefined();
  });

  it("findDanglingConfigs: a config importing ./tests is flagged when tests/ is excluded, not when it is present or the import is a file", () => {
    const cfg = { path: "playwright.config.ts", data: 'import x from "./tests/e2e/setup";' };
    expect(findDanglingConfigs([cfg, { path: "app/page.tsx", data: "" }])).toHaveLength(2);
    expect(findDanglingConfigs([cfg, { path: "tests/e2e/setup.ts", data: "" }])).toEqual([]);
    expect(findDanglingConfigs([{ path: "eslint.config.mjs", data: 'import n from "./next.config";' }, { path: "next.config.ts", data: "" }])).toEqual([]);
  });

  it("the ignore predicate matches the rules on synthetic paths", () => {
    const ignored = uploadIgnore(readFileSync(join(REPO_ROOT, ".liaraignore"), "utf8"));
    for (const p of [".env", ".env.local", ".env.production", "node_modules/next/index.js", ".next/server/app.js", "tests/unit/x.test.ts", "data/audit.jsonl", "scratch/spend-log.jsonl", "build.log", "a.zip"]) {
      expect(ignored(p), p).toBe(true);
    }
    for (const p of ["liara.json", "package.json", "package-lock.json", "lib/liara/deploy.ts", "app/page.tsx", "next.config.ts"]) expect(ignored(p), p).toBe(false);
  });

  it("the secret scan flags env files, key files, key material and known secret values (paths only, never the match)", () => {
    const keyBlock = "-----BEGIN " + "PRIVATE KEY-----";
    const problems = scanArchiveFiles(
      [
        { path: ".env", data: "A=1" },
        { path: "certs/server.pem", data: "x" },
        { path: "lib/leak.ts", data: `const k = "${keyBlock}";` },
        { path: "lib/token.ts", data: `export const t = "${TOKEN}";` },
        { path: "lib/ok.ts", data: "export const ok = 1;" },
      ],
      [TOKEN],
    );
    expect(problems).toEqual([".env: env file", "certs/server.pem: key/cert store", "lib/leak.ts: private key block", "lib/token.ts: contains the value of a secret env variable"]);
    expect(problems.join("\n")).not.toContain(TOKEN);
  });
});
