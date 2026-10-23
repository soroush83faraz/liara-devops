// Regression tests for the honesty review of verification (H1): "fixed" is never claimed without proof.
// Each case was a verified PoC before the fix: a restart that never happened, zero log lines, an empty logs body,
// a skipped probe and an un-read-back port all ended `verified` with «مشکل برطرف شد».
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureSnapshot } from "../../../lib/actions/snapshot";
import { buildVerification, verificationPolicy, verifyAction, type VerifyOptions } from "../../../lib/actions/verify";
import type { ActionParams } from "../../../lib/contracts/action";
import { VerificationSchema, type Snapshot, type Verification } from "../../../lib/contracts/proposal";
import { claimsFixed, verificationHeadline } from "../../../lib/copilot/verification";
import { fa } from "../../../lib/i18n/fa";
import { restartApp } from "../../../lib/liara";
import { setup, type TestEnv } from "./helpers";

async function verify(env: TestEnv, subject: ActionParams, before: Snapshot | undefined, opts: Partial<VerifyOptions> = {}): Promise<Verification> {
  let v: Verification | undefined;
  for await (const p of verifyAction({ liara: env.liara.client() }, subject, before, { ...env.deps.verify, ...opts })) if (p.kind === "result") v = p.verification;
  expect(VerificationSchema.safeParse(v).success).toBe(true);
  return v as Verification;
}
const status = (v: Verification, name: string) => v.checks.find((c) => c.name === name)?.status;
const fixed = (v: Verification) => claimsFixed(verificationHeadline(v));
const SHORT = { wait: { timeoutMs: 9_000, pollMs: 3_000 } };

describe("H1: no 'fixed' without proof", () => {
  it("P1 before-snapshot without applet names + in-place restart (old pods) -> restart_observed unknown, not_verified", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.replaceAppletsOnRestart = false;
    env.liara.fault("GET /v1/projects/shop/applets", { status: 500 });
    const before = await captureSnapshot(env.liara.client(), { type: "restart", app: "shop" }, env.clock.now());
    env.liara.faults.clear();
    const executedAt = env.clock.now();
    await restartApp(env.liara.client(), "shop");
    env.liara.log("shop", "listening", executedAt + 30_000);
    const v = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, ...SHORT });
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "restart_observed")).toBe("unknown");
    expect(v.checks.find((c) => c.name === "restart_observed")?.detail).toMatch(/could not be observed/);
    expect(fixed(v)).toBe(false);
  });

  it("P2 before === undefined + old pods still serving -> not_verified", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.replaceAppletsOnRestart = false;
    const v = await verify(env, { type: "restart", app: "shop" }, undefined, { executedAt: env.clock.now(), ...SHORT });
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "restart_observed")).toBe("unknown");
    expect(fixed(v)).toBe(false);
  });

  it("before === undefined but every running instance started after the change -> restart observed by start time", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const executedAt = env.clock.now();
    env.clock.advance(1_000);
    await restartApp(env.liara.client(), "shop");
    const v = await verify(env, { type: "restart", app: "shop" }, undefined, { executedAt });
    expect(status(v, "restart_observed")).toBe("passed");
    expect(v.outcome).toBe("verified");
  });

  it("P3 non-web app (probe skipped) + zero log lines -> only one signal (state) -> not_verified", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const before = await captureSnapshot(env.liara.client(), { type: "restart", app: "shop" }, env.clock.now());
    const executedAt = env.clock.now();
    await restartApp(env.liara.client(), "shop");
    const v = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, probe: null });
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "probe_skipped")).toBe("skipped");
    expect(v.checks.find((c) => c.name === "probe_skipped")?.passed).toBe(false);
    expect(status(v, "error_signature_absent")).toBe("unknown");
    expect(status(v, "independent_signals")).toBe("unknown");
    expect(fixed(v)).toBe(false);
  });

  it("P3b zero log lines never counts as 'error absent' (status unknown, not passed)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const before = await captureSnapshot(env.liara.client(), { type: "restart", app: "shop" }, env.clock.now());
    const executedAt = env.clock.now();
    await restartApp(env.liara.client(), "shop");
    const v = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, signatures: [{ kind: "missing_env", key: "SESSION_SECRET" }] });
    const c = v.checks.find((x) => x.name === "error_signature_absent");
    expect(c?.passed).toBe(false);
    expect(c?.status).toBe("unknown");
    expect(c?.detail).toMatch(/no log lines/);
    // the originating error is known, so its absence is REQUIRED
    expect(v.outcome).toBe("not_verified");
  });

  it("P4 logs endpoint answering {} is an empty window -> unknown, never passed", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.fault("GET /v2/projects/shop/logs", { status: 200, json: {} });
    const before = await captureSnapshot(env.liara.client(), { type: "restart", app: "shop" }, env.clock.now());
    const executedAt = env.clock.now();
    await restartApp(env.liara.client(), "shop");
    const v = await verify(env, { type: "restart", app: "shop" }, before, { executedAt, probe: null });
    expect(status(v, "error_signature_absent")).not.toBe("passed");
    expect(v.outcome).toBe("not_verified");
  });

  it("P5 update_port without a read-back of the port -> port_readback unknown, not_verified", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const v = await verify(env, { type: "update_port", app: "shop", port: 9999 }, undefined, { executedAt: env.clock.now() });
    expect(v.outcome).toBe("not_verified");
    expect(status(v, "port_readback")).toBe("unknown");
    expect(v.checks.find((c) => c.name === "port_readback")?.detail).toMatch(/could not be read back/);
    expect(fixed(v)).toBe(false);
  });

  it("update_port whose current release reports the requested port -> port_readback passed", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const v = await verify(env, { type: "update_port", app: "shop", port: 3000 }, undefined, { executedAt: env.clock.now() });
    expect(status(v, "port_readback")).toBe("passed");
    expect(v.outcome).toBe("verified");
  });

  it("P6 malformed payloads never headline as fixed (string/number `passed`, no checks, failed check)", () => {
    const bad = [
      { outcome: "verified", checks: [] },
      { outcome: "verified", checks: [{ name: "x", passed: false, detail: "" }] },
      { outcome: "verified", checks: [{ name: "x", passed: "true", detail: "" }] },
      { outcome: "verified", checks: [{ name: "x", passed: 1, detail: "" }] },
      { outcome: "verified", checks: [{ name: "x", passed: true, status: "unknown", detail: "" }] },
      { outcome: "verified", checks: [{ name: "x", passed: false, status: "skipped", detail: "" }] },
      { outcome: "weird", checks: [{ name: "x", passed: true, detail: "" }] },
    ];
    for (const v of bad) expect(claimsFixed(verificationHeadline(v as unknown as Verification))).toBe(false);
  });

  it("clean path still verified: running on new instances, 3 x 2xx (state + probe)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const before = await captureSnapshot(env.liara.client(), { type: "restart", app: "shop" }, env.clock.now());
    const executedAt = env.clock.now();
    await restartApp(env.liara.client(), "shop");
    const v = await verify(env, { type: "restart", app: "shop" }, before, { executedAt });
    expect(v.outcome).toBe("verified");
    expect(fixed(v)).toBe(true);
    // the empty log window is shown as unknown (amber), not as a passed check
    expect(status(v, "error_signature_absent")).toBe("unknown");
    expect(verificationHeadline(v)).toEqual({ kind: "verified", partial: true });
  });

  it("buildVerification: a single positive signal never verifies a runtime action; a required unknown blocks", () => {
    const policy = verificationPolicy({ type: "restart", app: "shop" });
    expect(policy).toEqual({ required: ["app_running", "restart_observed"], minSignals: 2 });
    const one = buildVerification(
      [
        { name: "app_running", passed: true, status: "passed", detail: "" },
        { name: "restart_observed", passed: true, status: "passed", detail: "" },
      ],
      undefined,
      undefined,
      policy,
    );
    expect(one.outcome).toBe("not_verified");
    expect(one.checks.map((c) => c.name)).toContain("independent_signals");
    const missingRequired = buildVerification(
      [
        { name: "app_running", passed: true, status: "passed", detail: "" },
        { name: "probe_2xx", passed: true, status: "passed", detail: "" },
      ],
      undefined,
      undefined,
      policy,
    );
    expect(missingRequired.outcome).toBe("not_verified");
    expect(missingRequired.checks.find((c) => c.name === "restart_observed")?.status).toBe("unknown");
  });
});

describe("H1: every check name the server can emit has a Persian label", () => {
  it("labels cover every emitted name (no raw English fallback, no dead labels)", () => {
    const dir = join(__dirname, "../../../lib/actions");
    const src = ["verify.ts", "verify-app.ts", "verify-resources.ts", "verify-support.ts"].map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    const emitted = new Set<string>();
    for (const m of src.matchAll(/\.(?:add|record)\(\s*"([a-z0-9_]+)"/g)) emitted.add(m[1]);
    for (const m of src.matchAll(/name: "([a-z0-9_]+)",\s*passed:/g)) emitted.add(m[1]);
    for (const m of src.matchAll(/required\.push\("([a-z0-9_]+)"\)/g)) emitted.add(m[1]);
    expect(emitted.size).toBeGreaterThan(15);
    const labels = fa.copilotUi.verification.checkNames as Record<string, string>;
    const missing = [...emitted].filter((n) => !labels[n]);
    expect(missing).toEqual([]);
    expect(Object.keys(labels).filter((k) => !emitted.has(k))).toEqual([]);
  });

  it("status labels: unknown and skipped are distinct from passed", () => {
    const l = fa.copilotUi.verification;
    expect(l.unknownCheck).toBe("قابل اثبات نیست");
    expect(l.skippedCheck).toBe("بررسی نشد");
    expect(new Set([l.passed, l.failedCheck, l.unknownCheck, l.skippedCheck]).size).toBe(4);
  });
});

describe("H1: presentation never greens an unproven check", () => {
  it("VerificationCard: only `passed` uses the ok tone; unknown amber, skipped neutral", async () => {
    const { CHECK_STATUS_VIEW } = await import("../../../components/copilot/verification-card");
    expect(CHECK_STATUS_VIEW.passed.icon).toBe("text-ok");
    for (const s of ["failed", "unknown", "skipped"] as const) expect(`${CHECK_STATUS_VIEW[s].icon} ${CHECK_STATUS_VIEW[s].text}`).not.toMatch(/text-ok/);
    expect(CHECK_STATUS_VIEW.unknown.icon).toBe("text-warn");
    expect(CHECK_STATUS_VIEW.skipped.label).toBe("بررسی نشد");
  });

  it("incident Markdown labels unknown/skipped checks honestly", async () => {
    const { renderIncidentMarkdown } = await import("../../../lib/actions/incident-markdown");
    const { sampleIncident } = await import("../../../lib/contracts/fixtures");
    const md = renderIncidentMarkdown({
      ...sampleIncident,
      verification: {
        outcome: "not_verified",
        checks: [
          { name: "app_running", passed: true, status: "passed", detail: "ok" },
          { name: "probe_skipped", passed: false, status: "skipped", detail: "non-web" },
          { name: "error_signature_absent", passed: false, status: "unknown", detail: "no log lines" },
        ],
      },
    });
    expect(md).toMatch(/`probe_skipped`: بررسی نشد/);
    expect(md).toMatch(/`error_signature_absent`: قابل اثبات نیست/);
  });
});

describe("H1: contract stays compatible and strict", () => {
  it("legacy checks without status still parse; passed:true with a non-passed status is rejected", () => {
    expect(VerificationSchema.safeParse({ outcome: "verified", checks: [{ name: "app_running", passed: true, detail: "" }] }).success).toBe(true);
    expect(VerificationSchema.safeParse({ outcome: "verified", checks: [{ name: "x", passed: true, status: "skipped", detail: "" }] }).success).toBe(false);
    // verified with only skipped/unknown checks is invalid: there must be a passed check
    expect(VerificationSchema.safeParse({ outcome: "verified", checks: [{ name: "x", passed: false, status: "skipped", detail: "" }] }).success).toBe(false);
    // not_verified may be named by an unproven (unknown) check
    expect(VerificationSchema.safeParse({ outcome: "not_verified", checks: [{ name: "port_readback", passed: false, status: "unknown", detail: "" }] }).success).toBe(true);
  });
});
