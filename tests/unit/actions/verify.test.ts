// Verification truth table. "Fixed" is never inferred from API acceptance. Synthetic data only.
import { describe, expect, it } from "vitest";
import { handleApprove, handleExecute } from "../../../lib/actions/http/proposals";
import { captureSnapshot } from "../../../lib/actions/snapshot";
import { verifyAction, type VerificationProgress, type VerifyOptions } from "../../../lib/actions/verify";
import type { ActionParams } from "../../../lib/contracts/action";
import type { Observation } from "../../../lib/contracts/observation";
import { VerificationSchema, type Proposal, type Snapshot, type Verification } from "../../../lib/contracts/proposal";
import { createRelease, restartApp } from "../../../lib/liara";
import { body, ctxFor, propose, setup, type TestEnv } from "./helpers";

async function verify(env: TestEnv, subject: ActionParams | Proposal, before: Snapshot | undefined, opts: Partial<VerifyOptions> = {}) {
  const progress: VerificationProgress[] = [];
  let v: Verification | undefined;
  for await (const p of verifyAction({ liara: env.liara.client() }, subject, before, { ...env.deps.verify, ...opts })) {
    progress.push(p);
    if (p.kind === "result") v = p.verification;
  }
  expect(v).toBeDefined();
  expect(VerificationSchema.safeParse(v).success).toBe(true);
  return { v: v as Verification, progress };
}

const failed = (v: Verification) => v.checks.filter((c) => c.status === "failed" || (c.status === undefined && !c.passed)).map((c) => c.name);
const names = (v: Verification) => v.checks.map((c) => c.name);

/** Snapshot, then a real (fake) restart, returning the execution time. */
async function restarted(env: TestEnv): Promise<{ before: Snapshot; executedAt: number }> {
  const before = await captureSnapshot(env.liara.client(), { type: "restart", app: "shop" }, env.clock.now());
  const executedAt = env.clock.now();
  await restartApp(env.liara.client(), "shop");
  return { before, executedAt };
}

describe("app runtime verification", () => {
  it("verified: running on a READY release, new instances, 3 probes >= 5 s apart all 2xx, no error signature", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const { before, executedAt } = await restarted(env);
    const start = env.clock.now();
    const { v, progress } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt });
    expect(v.outcome).toBe("verified");
    expect(names(v)).toEqual(expect.arrayContaining(["app_running", "restart_observed", "probe_2xx", "error_signature_absent"]));
    expect(env.probes.calls).toBe(3);
    expect(env.clock.now() - start).toBeGreaterThanOrEqual(10_000);
    expect(progress.at(-1)?.kind).toBe("result");
    expect(progress.filter((p) => p.kind === "check")).toHaveLength(v.checks.length);
    expect(v.before).toBeDefined();
    expect(v.after).toBeDefined();
  });

  it("API accepted but probes failing -> not_verified naming probe_2xx", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.probes.statuses = [200, 500, 503];
    const { before, executedAt } = await restarted(env);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt });
    expect(v.outcome).toBe("not_verified");
    expect(failed(v)).toEqual(["probe_2xx"]);
    expect(v.checks.find((c) => c.name === "probe_2xx")?.detail).toContain("200, 500, 503");
  });

  it("API accepted but no instance ever runs -> not_verified (app_running); probes and the log check still run and are listed", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.probes.statuses = [502];
    const { before, executedAt } = await restarted(env);
    env.liara.applets.set("shop", [{ name: "shop-pod-x", state: "CrashLoopBackOff", timestamp: new Date(env.clock.now() + 5).toISOString() }]);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt });
    expect(v.outcome).toBe("not_verified");
    expect(failed(v)).toEqual(expect.arrayContaining(["app_running", "probe_2xx"]));
    // Settling window (90 s, 5 s apart): stops once 3 consecutive 2xx can no longer be reached.
    expect(env.probes.calls).toBeGreaterThan(3);
    expect(env.probes.calls).toBeLessThanOrEqual(19);
    expect(v.checks.find((c) => c.name === "probe_2xx")?.detail).toMatch(/never 3 consecutive 2xx/);
    expect(names(v)).toContain("error_signature_absent");
  });

  it("zero instances after an accepted restart is never verified", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const { before, executedAt } = await restarted(env);
    env.liara.applets.set("shop", []);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, wait: { timeoutMs: 9_000, pollMs: 3_000 } });
    expect(v.outcome).not.toBe("verified");
  });

  it("old instances still serving -> not_verified (restart_observed) [VAL in-place restarts]", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.replaceAppletsOnRestart = false;
    const { before, executedAt } = await restarted(env);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, wait: { timeoutMs: 9_000, pollMs: 3_000 } });
    expect(v.outcome).toBe("not_verified");
    expect(failed(v)).toEqual(["restart_observed"]);
  });

  it("originating error still logged after the new instances settled -> not_verified (error_signature_absent)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const { before, executedAt } = await restarted(env);
    env.liara.log("shop", "Error: SESSION_SECRET is not defined", executedAt + 30_000);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, signatures: [{ kind: "missing_env", key: "SESSION_SECRET" }] });
    expect(v.outcome).toBe("not_verified");
    expect(failed(v)).toEqual(["error_signature_absent"]);
    expect(v.checks.find((c) => c.name === "error_signature_absent")?.detail).toContain("missing_env:SESSION_SECRET x1");
    expect(JSON.stringify(v)).not.toContain("is not defined");
  });

  it("error lines from before the restart (old instance) are ignored and reported; clean new-process lines pass", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const before = await captureSnapshot(env.liara.client(), { type: "restart", app: "shop" }, env.clock.now());
    const executedAt = env.clock.now();
    env.liara.log("shop", "Error: SESSION_SECRET is not defined", executedAt + 2_000);
    env.clock.advance(10_000);
    await restartApp(env.liara.client(), "shop");
    env.liara.log("shop", "listening on :3000", executedAt + 12_000);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, signatures: [{ kind: "missing_env", key: "SESSION_SECRET" }] });
    expect(v.outcome).toBe("verified");
    const d = v.checks.find((c) => c.name === "error_signature_absent")?.detail ?? "";
    expect(d).toContain("in 1 log lines after the restart");
    expect(d).toContain("1 lines from before the restart ignored (seen there: missing_env:SESSION_SECRET x1)");
  });

  it("signature from the proposal's cited evidence is checked", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const evidence: Observation[] = [
      { id: "O1", kind: "missing_env", severity: "error", source: "liara:logs", summary: "obs.missing_env", text: "x", params: { key: "PAYMENT_KEY" } },
    ];
    const { before, executedAt } = await restarted(env);
    const { v } = await verify(env, p, before, { executedAt, evidence });
    expect(v.checks.find((c) => c.name === "error_signature_absent")?.detail).toContain("missing_env:PAYMENT_KEY");
  });

  it("logs unavailable with a known originating error -> not_verified (absence cannot be shown, status unknown)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("GET /v2/projects/shop/logs", { status: 500 });
    const { before, executedAt } = await restarted(env);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, signatures: [{ kind: "missing_env", key: "SESSION_SECRET" }] });
    expect(v.outcome).toBe("not_verified");
    const c = v.checks.find((x) => x.name === "error_signature_absent");
    expect(c?.detail).toContain("logs unavailable");
    expect(c?.status).toBe("unknown");
    expect(c?.passed).toBe(false);
  });

  it("logs unavailable without an originating error: the log check stays unknown (amber), state + probe still verify", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("GET /v2/projects/shop/logs", { status: 500 });
    const { before, executedAt } = await restarted(env);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt });
    expect(v.outcome).toBe("verified");
    expect(v.checks.find((x) => x.name === "error_signature_absent")?.status).toBe("unknown");
  });

  it("lost acknowledgement -> not_verified even when the app looks healthy", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const { before, executedAt } = await restarted(env);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, mutationAcknowledged: false });
    expect(v.outcome).toBe("not_verified");
    expect(failed(v)).toEqual(["mutation_acknowledged"]);
  });

  it("non-web app (probe null) and no public URL: probes skipped (never green); verified only with a second signal from logs", async () => {
    for (const opts of [{ probe: null }, {}] as Array<Partial<VerifyOptions>>) {
      const env = setup();
      env.liara.addApp("shop");
      if (!("probe" in opts)) env.probes.statuses = ["no_url"];
      const { before, executedAt } = await restarted(env);
      env.liara.log("shop", "listening on :3000", executedAt + 30_000);
      const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, ...opts });
      expect(v.outcome).toBe("verified");
      const skipped = v.checks.find((c) => c.name === "probe_skipped");
      expect(skipped?.passed).toBe(false);
      expect(skipped?.status).toBe("skipped");
      expect(skipped?.detail).toMatch(/not performed/);
    }
  });

  it("redeploy whose new release FAILED -> failed", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.releaseFinalState = "FAILED";
    const before = await captureSnapshot(env.liara.client(), { type: "redeploy_previous", app: "shop", releaseId: "rel_shop_1" }, env.clock.now());
    const executedAt = env.clock.now();
    await createRelease(env.liara.client(), "shop", { image: "registry.example/shop:v0", port: 3000, type: "docker" });
    const { v } = await verify(env, { type: "redeploy_previous", app: "shop", releaseId: "rel_shop_1" }, before, { executedAt });
    expect(v.outcome).toBe("failed");
    expect(failed(v)).toContain("new_release");
  });

  it("Liara /applets answering 500: redeploy stays verifiable from release state + app status + probes + logs, applets listed as unavailable", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const subject = { type: "redeploy_previous", app: "shop", releaseId: "rel_shop_1" } as const;
    const before = await captureSnapshot(env.liara.client(), subject, env.clock.now());
    const executedAt = env.clock.now();
    await createRelease(env.liara.client(), "shop", { image: "registry.example/shop:v0", port: 3000, type: "docker" });
    env.liara.fault("GET /v1/projects/shop/applets", { status: 500 });
    env.liara.log("shop", "listening on :3000", executedAt + 30_000);
    const { v } = await verify(env, subject, before, { executedAt });
    const applets = v.checks.find((c) => c.name === "applets_available");
    expect(applets?.status).toBe("unknown");
    expect(applets?.detail).toMatch(/instance list \(applets\) was unavailable/);
    expect(v.checks.find((c) => c.name === "app_running")?.status).toBe("passed");
    expect(v.checks.find((c) => c.name === "app_running")?.detail).toMatch(/instance list was unavailable/);
    expect(v.checks.find((c) => c.name === "probe_2xx")?.status).toBe("passed");
    expect(v.outcome).toBe("verified");
  });

  it("Liara /applets answering 500: a restart cannot be observed -> not_verified, applets named as unavailable", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const { before, executedAt } = await restarted(env);
    env.liara.fault("GET /v1/projects/shop/applets", { status: 500 });
    env.liara.fault("GET /v1/projects/shop/events", { status: 500 });
    env.liara.log("shop", "listening on :3000", executedAt + 30_000);
    const { v } = await verify(env, { type: "restart", app: "shop" }, before, { executedAt });
    expect(v.outcome).toBe("not_verified");
    expect(v.checks.find((c) => c.name === "restart_observed")?.status).toBe("unknown");
    expect(v.checks.find((c) => c.name === "applets_available")?.status).toBe("unknown");
    expect(v.checks.find((c) => c.name === "state_readable")).toBeUndefined();
  });

  it("Liara /applets answering 500 on a stopped app: scale 0 is read back, the unreadable instance list is disclosed", async () => {
    const env = setup();
    env.liara.addApp("shop", { scale: 0 });
    env.liara.fault("GET /v1/projects/shop/applets", { status: 500 });
    const { v } = await verify(env, { type: "scale", resource: { kind: "app", name: "shop" }, scale: 0 }, undefined);
    expect(v.checks.find((c) => c.name === "app_stopped")?.status).toBe("passed");
    expect(v.checks.find((c) => c.name === "applets_available")?.status).toBe("unknown");
  });
});

describe("resource verification", () => {
  it("create: missing resource -> failed; present with the plan -> verified", async () => {
    const env = setup();
    const missing = await verify(env, { type: "create_app", name: "ghost", platform: "node", planId: "small-g2" }, undefined, { wait: { timeoutMs: 9_000, pollMs: 3_000 } });
    expect(missing.v.outcome).toBe("failed");
    expect(failed(missing.v)).toEqual(["resource_exists"]);
    env.liara.addApp("real", { planID: "small-g2" });
    const ok = await verify(env, { type: "create_app", name: "real", platform: "node", planId: "small-g2" }, undefined);
    expect(ok.v.outcome).toBe("verified");
    expect(names(ok.v)).toEqual(expect.arrayContaining(["resource_exists", "plan_matches", "platform_matches"]));
  });

  it("delete: gone -> verified; still there -> not_verified", async () => {
    const env = setup();
    const gone = await verify(env, { type: "delete_app", app: "shop" }, undefined);
    expect(gone.v.outcome).toBe("verified");
    env.liara.addApp("shop");
    const still = await verify(env, { type: "delete_app", app: "shop" }, undefined, { wait: { timeoutMs: 6_000, pollMs: 3_000 } });
    expect(still.v.outcome).toBe("not_verified");
    expect(failed(still.v)).toEqual(["resource_gone"]);
  });

  it("database scale/resize checks the DB state", async () => {
    const env = setup();
    env.liara.addDb("shop-db", { scale: 0, status: "STOPPED" });
    const stopped = await verify(env, { type: "scale", resource: { kind: "db", name: "shop-db" }, scale: 0 }, undefined);
    expect(stopped.v.outcome).toBe("verified");
    const notStarted = await verify(env, { type: "scale", resource: { kind: "db", name: "shop-db" }, scale: 1 }, undefined, { wait: { timeoutMs: 6_000, pollMs: 3_000 } });
    expect(notStarted.v.outcome).toBe("not_verified");
    expect(failed(notStarted.v)).toEqual(["db_state"]);
  });
});

describe("through the proposal flow", () => {
  it("probes failing after an accepted restart -> proposal ends not_verified, audited with the failed check", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.probes.statuses = [502];
    const p = await propose(env, { type: "restart", app: "shop" });
    const { approvalToken } = await body<{ approvalToken: string }>(await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps));
    expect((await handleExecute(ctxFor(env, { body: { approvalToken } }), p.id, env.deps)).status).toBe(202);
    await env.settle();
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("not_verified");
    const [entry] = await env.store.audit.read(env.accountId, { limit: 1 });
    expect(entry.detail).toContain("verification:not_verified");
    expect(entry.detail).toContain("failed_checks:probe_2xx");
  });
});
