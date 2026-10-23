import { describe, expect, it } from "vitest";
import {
  appReducer,
  appReviewGate,
  canAdvanceApp,
  canAdvanceDb,
  canAdvanceDeploy,
  dbEngines,
  dbReducer,
  dbReviewGate,
  defaultBundle,
  deployReducer,
  fileProblem,
  initialAppState,
  initialDbState,
  initialDeployState,
  initialNetworkState,
  networkChoiceValid,
  networkReducer,
  type AppWizardState,
  type DbWizardState,
} from "@/lib/create/wizards";
import { DB_ENGINES } from "@/lib/contracts/common";
import { MAX_UPLOAD_BYTES } from "@/lib/create/limits";
import { samplePlans } from "./helpers";

const plans = samplePlans();

describe("network wizard", () => {
  it("only advances with a valid, non-duplicate name, then needs the typed name", () => {
    let s = initialNetworkState();
    s = networkReducer(s, { type: "next", existingNames: [] });
    expect(s.step).toBe("form");
    s = networkReducer(s, { type: "set_name", name: "ab" });
    expect(networkReducer(s, { type: "next", existingNames: [] }).step).toBe("form");
    s = networkReducer(s, { type: "set_name", name: "main" });
    expect(networkReducer(s, { type: "next", existingNames: ["main"] }).step).toBe("form");
    s = networkReducer(s, { type: "set_name", name: "backend" });
    s = networkReducer(s, { type: "next", existingNames: ["main"] });
    expect(s.step).toBe("confirm");
    expect(networkReducer(s, { type: "submit_start" }).submit.phase).toBe("idle"); // not typed yet
    s = networkReducer(s, { type: "set_typed", typed: "backend " });
    s = networkReducer(s, { type: "submit_start" });
    expect(s.submit.phase).toBe("pending");
    expect(networkReducer(s, { type: "back" }).step).toBe("confirm"); // no back while pending
    s = networkReducer(s, { type: "submit_error", errorKey: "nameTaken" });
    expect(s.step).toBe("confirm");
    expect(s.submit).toMatchObject({ phase: "error", errorKey: "nameTaken" });
    expect(networkReducer(s, { type: "submit_success" })).toMatchObject({ step: "done" });
  });
});

describe("app wizard", () => {
  const advance = (s: AppWizardState) => appReducer(s, { type: "next", plans });

  it("walks name -> platform -> plan -> network -> review, blocking invalid steps", () => {
    let s = initialAppState();
    expect(advance(s).step).toBe("name");
    s = appReducer(s, { type: "set_name", name: "Bad Name" });
    expect(canAdvanceApp(s, plans)).toBe(false);
    s = appReducer(s, { type: "set_name", name: "shop-1" });
    s = advance(s);
    expect(s.step).toBe("platform");
    expect(advance(s).step).toBe("platform");
    s = advance(appReducer(s, { type: "set_platform", platform: "node" }));
    expect(s.step).toBe("plan");
    // unpriced plan is not selectable
    const unpriced = appReducer(s, { type: "set_plan", planId: "iran-g2-nopice", plans });
    expect(canAdvanceApp(unpriced, plans)).toBe(false);
    // plan with two bundles needs an explicit bundle
    s = appReducer(s, { type: "set_plan", planId: "iran-g2-small", plans });
    expect(s.bundlePlanId).toBeUndefined();
    expect(canAdvanceApp(s, plans)).toBe(false);
    s = advance(appReducer(s, { type: "set_bundle", bundlePlanId: "pro" }));
    expect(s.step).toBe("network");
    s = advance(s);
    expect(s.step).toBe("review");
    expect(advance(s).step).toBe("review");
    expect(appReducer(s, { type: "back" }).step).toBe("network");
  });

  it("free plan auto-selects the `free` bundle (the API demands it)", () => {
    expect(defaultBundle("free", {})).toBe("free");
    expect(defaultBundle("x", { x: [{ id: "only" }] })).toBe("only");
    expect(defaultBundle("x", { x: [{ id: "a" }, { id: "b" }] })).toBeUndefined();
    const s = appReducer(initialAppState(), { type: "set_plan", planId: "free", plans });
    expect(s.bundlePlanId).toBe("free");
  });

  it("network choice must exist / be new and valid", () => {
    expect(networkChoiceValid({ mode: "none" }, plans)).toBe(true);
    expect(networkChoiceValid({ mode: "existing", name: "main" }, plans)).toBe(true);
    expect(networkChoiceValid({ mode: "existing", name: "ghost" }, plans)).toBe(false);
    expect(networkChoiceValid({ mode: "new", name: "main" }, plans)).toBe(false);
    expect(networkChoiceValid({ mode: "new", name: "x" }, plans)).toBe(false);
    expect(networkChoiceValid({ mode: "new", name: "fresh-net" }, plans)).toBe(true);
  });

  const ready = (over: Partial<AppWizardState> = {}): AppWizardState => ({
    ...initialAppState(),
    step: "review",
    name: "shop-1",
    platform: "node",
    planId: "iran-g2-small",
    bundlePlanId: "standard",
    ack: true,
    typedName: "shop-1",
    ...over,
  });

  it("review gate: typed names, acknowledgement and cost", () => {
    expect(appReviewGate(ready(), plans)).toMatchObject({ canSubmit: true, cost: { hourly: 100, monthly: 72000 }, balance: { status: "ok" } });
    expect(appReviewGate(ready({ typedName: "shop" }), plans).blockers).toEqual(["typedName"]);
    expect(appReviewGate(ready({ ack: false }), plans).blockers).toEqual(["ack"]);
    const withNew = ready({ network: { mode: "new", name: "fresh-net" } });
    expect(appReviewGate(withNew, plans).blockers).toEqual(["typedNetwork"]);
    expect(appReviewGate({ ...withNew, typedNetwork: "fresh-net" }, plans).canSubmit).toBe(true);
    expect(appReviewGate({ ...withNew, networkCreated: true }, plans).canSubmit).toBe(true);
    expect(appReviewGate(ready({ planId: "ghost" }), plans).blockers).toContain("invalid");
  });

  it("review gate blocks when the known balance is below one hour; unknown balance does not block", () => {
    const poor = samplePlans({ balanceToman: 50 });
    const g = appReviewGate(ready(), poor);
    expect(g.canSubmit).toBe(false);
    expect(g.blockers).toEqual(["balance"]);
    expect(g.balance).toEqual({ status: "insufficient", balance: 50, needed: 100 });
    const { balanceToman: _omit, ...rest } = plans;
    void _omit;
    expect(appReviewGate(ready(), rest).canSubmit).toBe(true);
    // free plan never blocks on balance
    expect(appReviewGate(ready({ planId: "free", bundlePlanId: "free" }), samplePlans({ balanceToman: 0 })).canSubmit).toBe(true);
  });

  it("submit lifecycle incl. partial failure after the inline network was created", () => {
    let s = ready({ network: { mode: "new", name: "fresh-net" }, typedNetwork: "fresh-net" });
    s = appReducer(s, { type: "submit_start" });
    expect(s.submit).toEqual({ phase: "pending", stage: "network" });
    s = appReducer(s, { type: "stage_network_done" });
    expect(s.networkCreated).toBe(true);
    s = appReducer(s, { type: "submit_error", errorKey: "paymentRequired" });
    expect(s.step).toBe("review");
    // retry skips the network stage
    s = appReducer(s, { type: "submit_start" });
    expect(s.submit).toEqual({ phase: "pending", stage: "resource" });
    expect(appReducer(s, { type: "submit_start" })).toBe(s); // no double submit
    expect(appReducer(s, { type: "submit_success" }).step).toBe("done");
    // changing the network forgets that it was created
    expect(appReducer({ ...s, networkCreated: true }, { type: "set_network", network: { mode: "none" } }).networkCreated).toBe(false);
  });

  it("starts with a preset existing network", () => {
    expect(initialAppState("main").network).toEqual({ mode: "existing", name: "main" });
  });
});

describe("db wizard", () => {
  it("engine selection picks the default version and clears incompatible plans", () => {
    let s = initialDbState();
    s = dbReducer(s, { type: "set_engine", engine: "postgres", plans });
    expect(s.version).toBe("15"); // default
    s = dbReducer(s, { type: "set_engine", engine: "redis", plans });
    expect(s.version).toBe("7"); // default invalid -> first
    s = dbReducer(s, { type: "set_plan", planId: "iran-g2-small", plans: { ...plans } });
    s = dbReducer(s, { type: "set_engine", engine: "redis", plans });
    expect(s.planId).toBeUndefined(); // iran-g2-small does not support redis
  });

  it("engines are those with versions", () => {
    expect(dbEngines(plans, DB_ENGINES)).toEqual(["postgres", "redis"]);
  });

  const ready = (over: Partial<DbWizardState> = {}): DbWizardState => ({
    ...initialDbState(),
    step: "review",
    engine: "postgres",
    version: "16",
    planId: "iran-g2-small",
    bundlePlanId: "standard",
    name: "pg-main",
    ack: true,
    typedName: "pg-main",
    ...over,
  });

  it("walks the steps with validation", () => {
    let s = initialDbState();
    s = dbReducer(s, { type: "next", plans });
    expect(s.step).toBe("engine");
    s = dbReducer(s, { type: "set_engine", engine: "postgres", plans });
    s = dbReducer(s, { type: "next", plans });
    expect(s.step).toBe("plan");
    s = dbReducer(s, { type: "set_plan", planId: "iran-g2-small", plans });
    expect(s.bundlePlanId).toBe("standard"); // single bundle auto-selected
    s = dbReducer(s, { type: "next", plans });
    expect(s.step).toBe("settings");
    expect(canAdvanceDb(s, plans)).toBe(false); // no name
    s = dbReducer(s, { type: "set_name", name: "pg-main" });
    expect(canAdvanceDb(s, plans)).toBe(true);
    s = dbReducer(s, { type: "next", plans });
    expect(s.step).toBe("review");
  });

  it("public network needs the exposure acknowledgement and resets it when turned off", () => {
    let s = ready({ step: "settings" });
    s = dbReducer(s, { type: "set_public", value: true });
    expect(canAdvanceDb(s, plans)).toBe(false);
    s = dbReducer(s, { type: "set_public_ack", value: true });
    expect(canAdvanceDb(s, plans)).toBe(true);
    s = dbReducer(s, { type: "set_public", value: false });
    expect(s.publicAck).toBe(false);
  });

  it("review gate mirrors the app gate (cost 0.5/h = 360/month, balance, typed names)", () => {
    expect(dbReviewGate(ready(), plans)).toMatchObject({ canSubmit: true, cost: { hourly: 0.5, monthly: 360 } });
    expect(dbReviewGate(ready({ typedName: "x" }), plans).blockers).toEqual(["typedName"]);
    expect(dbReviewGate(ready(), samplePlans({ balanceToman: 0.1 })).blockers).toEqual(["balance"]);
    expect(dbReviewGate(ready({ engine: "redis" }), plans).blockers).toContain("invalid"); // plan does not support redis
    expect(dbReviewGate(ready({ publicNetwork: true }), plans).blockers).toContain("invalid"); // not acknowledged
  });
});

describe("deploy wizard", () => {
  const file = (name: string, size: number) => ({ name, size });

  it("validates files by type and size", () => {
    expect(fileProblem(file("a.zip", 10))).toBeNull();
    expect(fileProblem(file("a.tar.gz", MAX_UPLOAD_BYTES))).toBeNull();
    expect(fileProblem(file("a.tar.gz", MAX_UPLOAD_BYTES + 1))).toBe("tooLarge");
    expect(fileProblem(file("a.exe", 10))).toBe("type");
    expect(fileProblem(file("a.zip", 0))).toBe("empty");
  });

  it("source -> config -> review -> progress, only with valid input", () => {
    let s = initialDeployState("shop-1");
    expect(canAdvanceDeploy(s, ["node"])).toBe(false);
    s = deployReducer(s, { type: "next" });
    expect(s.step).toBe("source");
    s = deployReducer(s, { type: "set_file", file: file("big.zip", MAX_UPLOAD_BYTES + 1) });
    expect(deployReducer(s, { type: "next" }).step).toBe("source");
    s = deployReducer(s, { type: "set_file", file: file("ok.zip", 1000) });
    s = deployReducer(s, { type: "next" });
    expect(s.step).toBe("config");
    expect(s.port).toBe("3000"); // suggestion for node
    s = deployReducer(s, { type: "set_platform", platform: "python" });
    expect(s.port).toBe("8000"); // follows the suggestion until edited
    s = deployReducer(s, { type: "set_port", port: "80a80" });
    expect(s.port).toBe("8080");
    s = deployReducer(s, { type: "set_platform", platform: "node" });
    expect(s.port).toBe("8080"); // user-edited port is kept
    s = deployReducer(s, { type: "set_port", port: "" });
    expect(deployReducer(s, { type: "next" }).step).toBe("config");
    s = deployReducer(s, { type: "set_port", port: "3000" });
    s = deployReducer(s, { type: "next" });
    expect(s.step).toBe("review");
    expect(deployReducer(s, { type: "submit_start" }).submit.phase).toBe("idle"); // typed name missing
    s = deployReducer(s, { type: "set_typed", typed: "shop-2" });
    expect(deployReducer(s, { type: "submit_start" }).submit.phase).toBe("idle");
    s = deployReducer(s, { type: "set_typed", typed: "shop-1" });
    s = deployReducer(s, { type: "submit_start" });
    expect(s.submit.phase).toBe("pending");
    expect(deployReducer(s, { type: "back" }).step).toBe("review");
    s = deployReducer(s, { type: "submit_error", errorKey: "deployDailyCap", retryAfterSec: 3 });
    expect(s.step).toBe("review");
    s = deployReducer(s, { type: "submit_success", releaseId: "r1" });
    expect(s).toMatchObject({ step: "progress", releaseId: "r1" });
    expect(deployReducer(s, { type: "back" }).step).toBe("progress");
    expect(deployReducer(s, { type: "restart" })).toMatchObject({ step: "review", typedName: "", releaseId: undefined });
  });

  it("image source needs a tagged reference and ignores the platform", () => {
    let s = deployReducer(initialDeployState("shop-1"), { type: "set_kind", kind: "image" });
    s = deployReducer(s, { type: "set_image", image: "nginx" });
    expect(canAdvanceDeploy(s, [])).toBe(false);
    s = deployReducer(s, { type: "set_image", image: "nginx:1.27" });
    s = deployReducer(s, { type: "next" });
    expect(s.step).toBe("config");
    expect(canAdvanceDeploy(s, [])).toBe(true); // platform list irrelevant for images
  });
});
