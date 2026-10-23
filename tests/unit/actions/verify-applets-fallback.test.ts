// Live finding 2026-10-23 (S1, missing SESSION_SECRET): Liara's `GET /v1/projects/{name}/applets` answers 500 for
// some apps. The site went 500 -> 200 but verification polled 120 s, failed app_running on status "ACTIVE" and never
// listed the probes or the log check. These cases pin the fallback: app detail + release state for app_running,
// container events for restart_observed, probes + log check always listed, bounded polling. Synthetic data only.
import { describe, expect, it } from "vitest";
import { handleApprove, handleExecute } from "../../../lib/actions/http/proposals";
import { buildVerification, verifyAction, type VerifyOptions } from "../../../lib/actions/verify";
import { RESTART_EVENT_GRACE_MS } from "../../../lib/actions/verify-app";
import { VERIFY_PROBE_WINDOW_MS } from "../../../lib/actions/verify";
import type { ProbeResult } from "../../../lib/canvas/types";
import type { ActionParams } from "../../../lib/contracts/action";
import type { Observation } from "../../../lib/contracts/observation";
import { VerificationSchema, type Proposal, type Snapshot, type Verification } from "../../../lib/contracts/proposal";
import { checkBasis, VERIFY_BASIS_MARKERS } from "../../../lib/contracts/verification-basis";
import { claimsFixed, verificationHeadline } from "../../../lib/copilot/verification";
import { parseLifecycleEvents } from "../../../lib/liara";
import { body, ctxFor, propose, setup, type TestEnv } from "./helpers";

const S1: ActionParams = { type: "set_env", app: "shop", changes: [{ op: "set", key: "SESSION_SECRET", valueSource: "generated", generator: "hex32" }] };

/** What the investigation saw before the change: the missing key in the logs and a 500 from the probe. */
const EVIDENCE: Observation[] = [
  { id: "O1", kind: "missing_env", severity: "error", source: "liara:logs", summary: "obs.missing_env", text: "x", params: { key: "SESSION_SECRET" } },
  { id: "O2", kind: "probe", severity: "error", source: "probe", summary: "evidence.probe.5xx", text: "GET / -> 500", params: { ok: 0, status: 500, latencyMs: 40 } },
];

const status = (v: Verification, name: string) => v.checks.find((c) => c.name === name)?.status;
const detail = (v: Verification, name: string) => v.checks.find((c) => c.name === name)?.detail ?? "";
const calls = (env: TestEnv, path: string) => env.liara.calls.filter((c) => c.method === "GET" && c.path === path).length;

async function verify(env: TestEnv, subject: ActionParams | Proposal, before: Snapshot | undefined, opts: Partial<VerifyOptions> = {}): Promise<Verification> {
  let v: Verification | undefined;
  for await (const p of verifyAction({ liara: env.liara.client() }, subject, before, { ...env.deps.verify, wait: { timeoutMs: 120_000, pollMs: 3_000 }, ...opts })) {
    if (p.kind === "result") v = p.verification;
  }
  expect(VerificationSchema.safeParse(v).success).toBe(true);
  return v as Verification;
}

/** The live S1 situation after the env change was applied: ACTIVE app, READY release, applets 500. */
function s1(opts: { restartAfterMs?: number; newLogs?: boolean } = {}): { env: TestEnv; executedAt: number } {
  const env = setup();
  env.liara.addApp("shop", { status: "ACTIVE" });
  env.liara.fault("GET /v1/projects/shop/applets", { status: 500 });
  const executedAt = env.clock.now();
  env.liara.apps.get("shop")!.envs.push({ key: "SESSION_SECRET", value: "SYNTH-generated-0123456789abcdef" });
  if (opts.restartAfterMs !== undefined) {
    env.liara.event("shop", "die", executedAt + opts.restartAfterMs - 500);
    env.liara.event("shop", "create", executedAt + opts.restartAfterMs);
    env.liara.event("shop", "start", executedAt + opts.restartAfterMs + 400);
  }
  if (opts.newLogs !== false) env.liara.log("shop", "server listening on :3000", executedAt + 3_000);
  return { env, executedAt };
}

describe("applets 500: verification falls back to app detail + events", () => {
  it("healthy app + restart event after execution + 3 x 2xx + signature absent -> verified, with the exact check list", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    const start = env.clock.now();
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE, signatures: [{ kind: "missing_env", key: "SESSION_SECRET" }] });
    expect(v.checks.map((c) => [c.name, c.status])).toEqual([
      ["env_keys_applied", "passed"],
      ["applets_available", "unknown"],
      ["app_running", "passed"],
      ["restart_observed", "passed"],
      ["probe_2xx", "passed"],
      ["behavior_changed", "passed"],
      ["error_signature_absent", "passed"],
    ]);
    expect(v.outcome).toBe("verified");
    expect(claimsFixed(verificationHeadline(v))).toBe(true);
    expect(detail(v, "app_running")).toContain("app status ACTIVE, scale 1, deployed true, release READY");
    expect(detail(v, "app_running")).toContain(VERIFY_BASIS_MARKERS.appDetail);
    expect(detail(v, "restart_observed")).toContain(VERIFY_BASIS_MARKERS.events);
    expect(detail(v, "behavior_changed")).toContain("from 500 to 2xx");
    expect(detail(v, "behavior_changed")).toContain("(attempts: 200, 200, 200)");
    expect(detail(v, "probe_2xx")).toBe("200, 200, 200 over 10 s: 3 consecutive 2xx, 5 s apart");
    expect(checkBasis(v.checks.find((c) => c.name === "restart_observed")!)).toBe("events");
    // Settled on the first read: no waiting for the 120 s timeout (probes take 2 x 5 s).
    expect(calls(env, "/v1/projects/shop/events")).toBe(1);
    expect(env.clock.now() - start).toBeLessThan(15_000);
  });

  it("the before/after contrast never stands in for a required check nor counts as a second independent source", () => {
    const v = buildVerification(
      [
        { name: "app_running", passed: true, status: "passed", detail: "" },
        { name: "restart_observed", passed: false, status: "unknown", detail: "" },
        { name: "probe_2xx", passed: true, status: "passed", detail: "" },
        { name: "behavior_changed", passed: true, status: "passed", detail: "" },
      ],
      undefined,
      undefined,
      { required: ["app_running", "restart_observed"], minSignals: 2 },
    );
    expect(v.outcome).toBe("not_verified");
    const probeOnly = buildVerification(
      [
        { name: "probe_2xx", passed: true, status: "passed", detail: "" },
        { name: "behavior_changed", passed: true, status: "passed", detail: "" },
      ],
      undefined,
      undefined,
      { required: [], minSignals: 2 },
    );
    expect(probeOnly.outcome).toBe("not_verified");
    expect(probeOnly.checks.map((c) => c.name)).toContain("independent_signals");
  });

  it("events returned in any order (live shape, oldest first) still show the restart", async () => {
    const { env, executedAt } = s1();
    const sec = (ms: number) => String(Math.floor(ms / 1000));
    env.liara.fault("GET /v1/projects/shop/events", {
      status: 200,
      json: {
        data: [
          { id: "a", status: "create", action: "create", time: sec(executedAt - 86_400_000), release: "rel_shop_init", tag: "v1" },
          { id: "b", status: "start", action: "start", time: sec(executedAt + 4_000), release: "rel_shop_init", tag: "v1" },
          { id: "c", status: "die", action: "die", time: sec(executedAt + 3_000), release: "rel_shop_init", tag: "v1" },
        ],
      },
    });
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE });
    expect(status(v, "restart_observed")).toBe("passed");
    expect(detail(v, "restart_observed")).toContain(`"start" event at ${new Date(executedAt + 4_000).toISOString()}`);
    expect(v.outcome).toBe("verified");
  });

  it("applets 500 + events unavailable -> not_verified, restart_observed unknown; probes and log check still listed; bounded polls", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.liara.fault("GET /v1/projects/shop/events", { status: 500 });
    const start = env.clock.now();
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE, signatures: [{ kind: "missing_env", key: "SESSION_SECRET" }] });
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "restart_observed")).toBe("unknown");
    expect(detail(v, "restart_observed")).toMatch(/could not be observed.*events could not be read \(server\)/);
    expect(status(v, "app_running")).toBe("passed");
    expect(status(v, "probe_2xx")).toBe("passed");
    expect(status(v, "error_signature_absent")).toBe("passed");
    expect(claimsFixed(verificationHeadline(v))).toBe(false);
    // Healthy app, unobservable restart: the wait stops after the bounded grace, not at the 120 s timeout.
    const elapsed = env.clock.now() - start;
    expect(elapsed).toBeLessThan(RESTART_EVENT_GRACE_MS + 10_000 + 10_000);
    expect(elapsed).toBeLessThan(60_000);
    // <= 6 state polls + 1 re-read of the current release for the log attribution.
    expect(calls(env, "/v1/projects/shop/releases")).toBeLessThanOrEqual(7);
  });

  it("applets 500 + only events older than the execution -> restart not observed (unknown), not_verified", async () => {
    const { env, executedAt } = s1();
    env.liara.event("shop", "create", executedAt - 60_000);
    env.liara.event("shop", "start", executedAt - 59_000);
    // Same second as the execution: not provably after it.
    env.liara.event("shop", "start", executedAt + 900);
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE });
    expect(status(v, "restart_observed")).toBe("unknown");
    expect(detail(v, "restart_observed")).toMatch(/events show no container start after the change \(3 events/);
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "probe_2xx")).toBe("passed");
  });

  it("applets 500 + current release FAILED -> failed (stops at once); probes and log check still listed", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.liara.releases.get("shop")![0].state = "FAILED";
    env.probes.statuses = [503];
    const start = env.clock.now();
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE });
    expect(v.outcome).toBe("failed");
    expect(status(v, "app_running")).toBe("failed");
    expect(detail(v, "app_running")).toContain("contradicting: release FAILED");
    expect(status(v, "probe_2xx")).toBe("failed");
    expect(v.checks.map((c) => c.name)).toContain("error_signature_absent");
    expect(calls(env, "/v1/projects/shop/events")).toBe(1);
    expect(env.clock.now() - start).toBeLessThan(15_000);
  });

  it("applets 500 + app scaled to 0 -> app_running failed on the contradiction (not unknown)", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.liara.apps.get("shop")!.scale = 0;
    const v = await verify(env, S1, undefined, { executedAt, wait: { timeoutMs: 9_000, pollMs: 3_000 } });
    expect(status(v, "app_running")).toBe("failed");
    expect(detail(v, "app_running")).toContain("contradicting: scale 0");
    expect(v.outcome).toBe("not_verified");
  });

  it("applets 500 + app detail unreadable -> app_running unknown (not failed), not_verified", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.liara.fault("GET /v1/projects/shop", { status: 500 });
    const v = await verify(env, S1, undefined, { executedAt, wait: { timeoutMs: 9_000, pollMs: 3_000 } });
    expect(status(v, "app_running")).toBe("unknown");
    expect(detail(v, "app_running")).toContain("could not be read: app detail (server)");
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "probe_2xx")).toBe("passed");
  });

  it("applets 500 + probe 5xx -> not_verified (probe_2xx failed), no before/after contrast", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.probes.statuses = [200, 500, 502];
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE });
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "probe_2xx")).toBe("failed");
    expect(v.checks.map((c) => c.name)).not.toContain("behavior_changed");
  });

  it("applets 500 + the error signature recurring after the change -> not_verified (error_signature_absent failed)", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.liara.log("shop", "Error: SESSION_SECRET is not defined", executedAt + 8_000);
    const p = await propose(env, S1);
    const v = await verify(env, p, undefined, { executedAt, evidence: EVIDENCE });
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "error_signature_absent")).toBe("failed");
    expect(detail(v, "error_signature_absent")).toContain("missing_env:SESSION_SECRET x1");
  });

  it("through the proposal flow (S1, applets 500): set_env ends verified via events", async () => {
    const env = setup();
    env.liara.addApp("shop", { status: "ACTIVE" });
    env.liara.fault("GET /v1/projects/shop/applets", { status: 500 });
    // The container is recreated a couple of seconds after the env write (as on Liara).
    env.liara.envUpdateHook = () => env.clock.advance(2_500);
    env.liara.log("shop", "server listening on :3000", env.clock.now() + 4_000);
    const p = await propose(env, S1);
    const { approvalToken } = await body<{ approvalToken: string }>(await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps));
    expect((await handleExecute(ctxFor(env, { body: { approvalToken } }), p.id, env.deps)).status).toBe(202);
    await env.settle();
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("verified");
    const [entry] = await env.store.audit.read(env.accountId, { limit: 1 });
    expect(entry.detail).toContain("verification:verified");
    expect(entry.detail).toContain("unproven_checks:applets_available");
  });
});

describe("rolling restart: settling probes and the post-restart log window", () => {
  const SIG = { signatures: [{ kind: "missing_env" as const, key: "SESSION_SECRET" }] };

  it("probes 500, 500, 200, 200, 200 (old instance still serving) -> probe_2xx passes after settling, attempts listed", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.probes.statuses = [500, 500, 200, 200, 200];
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "probe_2xx")).toBe("passed");
    expect(detail(v, "probe_2xx")).toBe("500, 500, 200, 200, 200 over 20 s: 3 consecutive 2xx, 5 s apart");
    expect(detail(v, "behavior_changed")).toContain("(attempts: 500, 500, 200, 200, 200)");
    expect(v.outcome).toBe("verified");
    expect(env.probes.calls).toBe(5);
  });

  it("permanent 500 -> probe_2xx failed when the window can no longer produce 3 consecutive 2xx; bounded time", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.probes.statuses = [500];
    const start = env.clock.now();
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "probe_2xx")).toBe("failed");
    expect(detail(v, "probe_2xx")).toMatch(/^500(, 500){16} over 80 s: never 3 consecutive 2xx 5 s apart \(17 attempts, window 90 s\)$/);
    expect(v.checks.map((c) => c.name)).not.toContain("behavior_changed");
    expect(v.outcome).toBe("not_verified");
    expect(env.clock.now() - start).toBeLessThanOrEqual(VERIFY_PROBE_WINDOW_MS + RESTART_EVENT_GRACE_MS);
  });

  it("flapping 200, 500, 200, 500, ... -> never 3 consecutive 2xx -> failed", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    let n = 0;
    const probe = async (): Promise<ProbeResult> => {
      const st = n++ % 2 === 0 ? 200 : 500;
      return { ok: st < 400, status: st, latencyMs: 5, checkedAt: new Date(env.clock.now()).toISOString() };
    };
    const start = env.clock.now();
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE, probe, ...SIG });
    expect(status(v, "probe_2xx")).toBe("failed");
    expect(detail(v, "probe_2xx")).toMatch(/^200, 500, 200, 500, .* never 3 consecutive 2xx/);
    expect(v.outcome).toBe("not_verified");
    expect(n).toBeLessThanOrEqual(19);
    expect(env.clock.now() - start).toBeLessThanOrEqual(VERIFY_PROBE_WINDOW_MS + RESTART_EVENT_GRACE_MS);
  });

  it("old-container error lines before the restart are ignored and reported; clean new-process lines pass", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.liara.log("shop", "Error: SESSION_SECRET is not defined", executedAt + 500);
    env.liara.log("shop", "Error: SESSION_SECRET is not defined", executedAt + 1_200);
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("passed");
    const restart = new Date(executedAt + 2_000).toISOString();
    expect(detail(v, "error_signature_absent")).toBe(
      `checked missing_env:SESSION_SECRET, crash:*, oom in 1 log lines after the restart (${restart}); 2 lines from before the restart ignored (seen there: missing_env:SESSION_SECRET x2)`,
    );
    expect(v.outcome).toBe("verified");
  });

  it("only old-container lines and no new-process output -> error_signature_absent unknown, not_verified", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000, newLogs: false });
    env.liara.log("shop", "Error: SESSION_SECRET is not defined", executedAt + 500);
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("unknown");
    expect(detail(v, "error_signature_absent")).toMatch(/^no log lines after the restart .*1 lines from before the restart ignored/);
    expect(v.outcome).toBe("not_verified");
  });

  it("the signature recurring after the restart -> failed, earlier lines still reported as ignored", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000 });
    env.liara.log("shop", "Error: SESSION_SECRET is not defined", executedAt + 500);
    env.liara.log("shop", "Error: SESSION_SECRET is not defined", executedAt + 9_000);
    const v = await verify(env, S1, undefined, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("failed");
    expect(detail(v, "error_signature_absent")).toMatch(/seen after the restart .*: missing_env:SESSION_SECRET x1; 1 lines from before the restart ignored/);
    expect(v.outcome).toBe("not_verified");
  });
});

describe("log attribution: new release first, strict time fallback", () => {
  const SIG = { signatures: [{ kind: "missing_env" as const, key: "SESSION_SECRET" }] };
  const ERR = "Error: SESSION_SECRET is not defined";
  const OLD = "rel_shop_init";
  const NEW = "rel_shop_new";

  /** S1 where the env change put a new release in force (live 2026-10-23); restart event second = executedAt + 2 s. */
  function newRelease(): { env: TestEnv; executedAt: number; before: Snapshot } {
    const { env, executedAt } = s1({ restartAfterMs: 2_000, newLogs: false });
    env.liara.releases.get("shop")!.push({ _id: NEW, state: "READY", port: 3000, type: "node", createdAt: new Date(executedAt + 1_500).toISOString() });
    env.liara.current.set("shop", NEW);
    return { env, executedAt, before: { currentReleaseId: OLD } };
  }

  it("old-release error in the restart second + clean new-release lines -> passed, previous release disclosed as ignored", async () => {
    const { env, executedAt, before } = newRelease();
    env.liara.log("shop", ERR, executedAt + 2_300, OLD);
    env.liara.log("shop", "server listening on :3000", executedAt + 2_600, NEW);
    env.liara.log("shop", "GET / 200", executedAt + 9_000, NEW);
    const v = await verify(env, S1, before, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("passed");
    expect(detail(v, "error_signature_absent")).toBe(
      `checked missing_env:SESSION_SECRET, crash:*, oom in 2 log lines from the new release ${NEW}; 1 lines from the previous release ${OLD} ignored (seen there: missing_env:SESSION_SECRET x1)`,
    );
    expect(v.outcome).toBe("verified");
  });

  it("the signature in a new-release line -> failed", async () => {
    const { env, executedAt, before } = newRelease();
    env.liara.log("shop", "server listening on :3000", executedAt + 2_600, NEW);
    env.liara.log("shop", ERR, executedAt + 2_700, NEW);
    const v = await verify(env, S1, before, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("failed");
    expect(detail(v, "error_signature_absent")).toContain(`seen from the new release ${NEW}: missing_env:SESSION_SECRET x1`);
    expect(v.outcome).toBe("not_verified");
  });

  it("only old-release lines (even after the restart second) -> unknown, not_verified", async () => {
    const { env, executedAt, before } = newRelease();
    env.liara.log("shop", ERR, executedAt + 5_000, OLD);
    const v = await verify(env, S1, before, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("unknown");
    expect(detail(v, "error_signature_absent")).toMatch(new RegExp(`^no log lines from the new release ${NEW} .*1 lines from the previous release ${OLD} ignored`));
    expect(v.outcome).toBe("not_verified");
  });

  it("same release (plain restart): a line in the restart second is not attributed; strictly later clean lines pass", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000, newLogs: false });
    env.liara.log("shop", ERR, executedAt + 2_300, OLD);
    env.liara.log("shop", "server listening on :3000", executedAt + 3_100, OLD);
    const v = await verify(env, S1, { currentReleaseId: OLD }, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("passed");
    expect(detail(v, "error_signature_absent")).toBe(
      `checked missing_env:SESSION_SECRET, crash:*, oom in 1 log lines after the restart (${new Date(executedAt + 2_000).toISOString()}); 0 lines from before the restart ignored; 1 lines in the restart second not attributed (seen there: missing_env:SESSION_SECRET x1)`,
    );
  });

  it("same release: the signature strictly after the restart second -> failed", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000, newLogs: false });
    env.liara.log("shop", ERR, executedAt + 3_000, OLD);
    const v = await verify(env, S1, { currentReleaseId: OLD }, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("failed");
    expect(v.outcome).toBe("not_verified");
  });

  it("same release: only lines in the restart second -> unknown (nothing attributable)", async () => {
    const { env, executedAt } = s1({ restartAfterMs: 2_000, newLogs: false });
    env.liara.log("shop", "server listening on :3000", executedAt + 2_500, OLD);
    const v = await verify(env, S1, { currentReleaseId: OLD }, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("unknown");
    expect(detail(v, "error_signature_absent")).toContain("1 lines in the restart second not attributed");
  });

  it("new release but log groups without releaseId -> time fallback (restart second not attributed)", async () => {
    const { env, executedAt, before } = newRelease();
    env.liara.log("shop", ERR, executedAt + 2_300);
    env.liara.log("shop", "server listening on :3000", executedAt + 3_000);
    const v = await verify(env, S1, before, { executedAt, evidence: EVIDENCE, ...SIG });
    expect(status(v, "error_signature_absent")).toBe("passed");
    const d = detail(v, "error_signature_absent");
    expect(d).toContain(`in 1 log lines after the restart (${new Date(executedAt + 2_000).toISOString()})`);
    expect(d).toContain("1 lines in the restart second not attributed (seen there: missing_env:SESSION_SECRET x1)");
    expect(d).toContain(`0 lines from the previous release ${OLD} ignored`);
  });
});

describe("lifecycle events parser", () => {
  it("parses the live shape (unix seconds as strings) and drops malformed rows", () => {
    const ev = parseLifecycleEvents({
      data: [
        { id: "1", status: "start", action: "start", time: "1792720496", release: "r1", tag: "v1" },
        { id: "2", status: "create", action: "create", time: "1792720495" },
        { id: "3", action: "start", time: "not-a-time" },
        { id: "4", time: "1792720497" },
        "junk",
      ],
    });
    expect(ev).toEqual([
      { ts: 1792720495000, action: "create", status: "create", containerId: "2" },
      { ts: 1792720496000, action: "start", status: "start", releaseId: "r1", tag: "v1", containerId: "1" },
    ]);
    expect(parseLifecycleEvents({})).toEqual([]);
    expect(parseLifecycleEvents(null)).toEqual([]);
  });
});
