// State machines of the create wizards (pure reducers + validity/gating helpers). No React, no I/O.
// The components dispatch actions; a step can only be left forward when `canAdvance*` says so.
import { matchesName } from "@/components/ui/confirm-match";
import { PLATFORMS } from "@/lib/contracts/common";
import { balanceGate, totalCost, type BalanceGate, type CostLine } from "./cost";
import type { ErrorKey } from "./errors";
import { dbPlansFor, isSelectable } from "./plans";
import type { PlansResponse } from "./types";
import {
  archiveKindFromName,
  suggestPort,
  validateAppName,
  validateDbName,
  validateImage,
  validateNetworkName,
  validatePort,
} from "./validators";
import { MAX_UPLOAD_BYTES } from "./limits";

/* ------------------------------------------------------------------ shared */

export type SubmitState =
  | { phase: "idle" }
  | { phase: "pending"; stage?: "network" | "resource" }
  | { phase: "error"; errorKey: ErrorKey; retryAfterSec?: number }
  | { phase: "success" };

const IDLE: SubmitState = { phase: "idle" };

export type NetworkChoice = { mode: "none" } | { mode: "existing"; name: string } | { mode: "new"; name: string };

export function networkChoiceValid(choice: NetworkChoice, plans: PlansResponse): boolean {
  switch (choice.mode) {
    case "none":
      return true;
    case "existing":
      return plans.networks.some((n) => n.name === choice.name);
    case "new":
      return validateNetworkName(choice.name) === null && !plans.networks.some((n) => n.name === choice.name);
  }
}

/** The network name the resource will join (undefined for «بدون شبکه»). */
export const networkNameOf = (c: NetworkChoice): string | undefined => (c.mode === "none" ? undefined : c.name);

export function nextStep<S extends string>(steps: readonly S[], current: S): S {
  const i = steps.indexOf(current);
  return steps[Math.min(steps.length - 1, i + 1)];
}
export function prevStep<S extends string>(steps: readonly S[], current: S): S {
  const i = steps.indexOf(current);
  return steps[Math.max(0, i - 1)];
}

/** Bundle auto-selection: exactly one offered -> it; `free` plan with none offered -> "free" (the API demands it). */
export function defaultBundle(planId: string, offered: Record<string, Array<{ id: string }>>): string | undefined {
  const list = offered[planId] ?? [];
  if (list.length === 1) return list[0].id;
  if (list.length === 0 && planId === "free") return "free";
  return undefined;
}

function bundleOk(planId: string | undefined, bundleId: string | undefined, offered: Record<string, Array<{ id: string }>>): boolean {
  if (!planId) return false;
  const list = offered[planId] ?? [];
  return list.length === 0 || (bundleId !== undefined && list.some((b) => b.id === bundleId));
}

export type ReviewBlocker = "typedName" | "typedNetwork" | "ack" | "balance" | "costUnknown" | "invalid";

export interface ReviewGate {
  blockers: ReviewBlocker[];
  canSubmit: boolean;
  cost: CostLine | null;
  balance: BalanceGate;
}

function buildGate(blockers: ReviewBlocker[], hourly: number | undefined, plans: PlansResponse): ReviewGate {
  const cost = totalCost([hourly]);
  const balance = balanceGate(plans.balanceToman, hourly, plans.balanceUnreadable === true);
  const all = [...blockers];
  if (!cost) all.push("costUnknown");
  if (balance.status === "insufficient" || balance.status === "team_unreadable") all.push("balance");
  return { blockers: all, canSubmit: all.length === 0, cost, balance };
}

/* ----------------------------------------------------------------- network */

export const NETWORK_STEPS = ["form", "confirm"] as const;
export type NetworkStep = (typeof NETWORK_STEPS)[number] | "done";

export interface NetworkState {
  step: NetworkStep;
  name: string;
  typed: string;
  submit: SubmitState;
}
export const initialNetworkState = (): NetworkState => ({ step: "form", name: "", typed: "", submit: IDLE });

export type NetworkAction =
  | { type: "set_name"; name: string }
  | { type: "set_typed"; typed: string }
  | { type: "next"; existingNames: readonly string[] }
  | { type: "back" }
  | { type: "submit_start" }
  | { type: "submit_error"; errorKey: ErrorKey; retryAfterSec?: number }
  | { type: "submit_success" };

export function networkFormError(name: string, existing: readonly string[]): ReturnType<typeof validateNetworkName> | "duplicate" {
  return validateNetworkName(name) ?? (existing.includes(name) ? "duplicate" : null);
}

export function networkReducer(s: NetworkState, a: NetworkAction): NetworkState {
  switch (a.type) {
    case "set_name":
      return { ...s, name: a.name.trim(), typed: "", submit: IDLE };
    case "set_typed":
      return { ...s, typed: a.typed };
    case "next":
      return s.step === "form" && networkFormError(s.name, a.existingNames) === null ? { ...s, step: "confirm" } : s;
    case "back":
      return s.step === "confirm" && s.submit.phase !== "pending" ? { ...s, step: "form", typed: "", submit: IDLE } : s;
    case "submit_start":
      return s.step === "confirm" && matchesName(s.typed, s.name) && s.submit.phase !== "pending" ? { ...s, submit: { phase: "pending" } } : s;
    case "submit_error":
      return { ...s, submit: { phase: "error", errorKey: a.errorKey, retryAfterSec: a.retryAfterSec } };
    case "submit_success":
      return { ...s, step: "done", submit: { phase: "success" } };
  }
}

/* --------------------------------------------------------------------- app */

export const APP_STEPS = ["name", "platform", "plan", "network", "review"] as const;
export type AppStep = (typeof APP_STEPS)[number] | "done";

export interface AppWizardState {
  step: AppStep;
  name: string;
  platform?: string;
  planId?: string;
  bundlePlanId?: string;
  network: NetworkChoice;
  /** The inline network was already created by a previous (partly failed) submit. */
  networkCreated: boolean;
  typedName: string;
  typedNetwork: string;
  ack: boolean;
  submit: SubmitState;
}

export const initialAppState = (network?: string): AppWizardState => ({
  step: "name",
  name: "",
  network: network ? { mode: "existing", name: network } : { mode: "none" },
  networkCreated: false,
  typedName: "",
  typedNetwork: "",
  ack: false,
  submit: IDLE,
});

export type AppAction =
  | { type: "set_name"; name: string }
  | { type: "set_platform"; platform: string }
  | { type: "set_plan"; planId: string; plans: PlansResponse }
  | { type: "set_bundle"; bundlePlanId: string }
  | { type: "set_network"; network: NetworkChoice }
  | { type: "set_typed_name"; typed: string }
  | { type: "set_typed_network"; typed: string }
  | { type: "set_ack"; ack: boolean }
  | { type: "next"; plans: PlansResponse }
  | { type: "back" }
  | { type: "submit_start" }
  | { type: "stage_network_done" }
  | { type: "submit_error"; errorKey: ErrorKey; retryAfterSec?: number }
  | { type: "submit_success" };

export function canAdvanceApp(s: AppWizardState, plans: PlansResponse): boolean {
  switch (s.step) {
    case "name":
      return validateAppName(s.name) === null;
    case "platform":
      return !!s.platform && plans.platforms.includes(s.platform);
    case "plan": {
      const plan = plans.appPlans.find((p) => p.id === s.planId);
      return !!plan && isSelectable(plan) && bundleOk(s.planId, s.bundlePlanId, plans.bundlePlans);
    }
    case "network":
      return networkChoiceValid(s.network, plans);
    default:
      return false;
  }
}

export function appReviewGate(s: AppWizardState, plans: PlansResponse): ReviewGate {
  const blockers: ReviewBlocker[] = [];
  const valid =
    validateAppName(s.name) === null &&
    !!s.platform &&
    canAdvanceApp({ ...s, step: "plan" }, plans) &&
    networkChoiceValid(s.network, plans);
  if (!valid) blockers.push("invalid");
  if (!matchesName(s.typedName, s.name)) blockers.push("typedName");
  if (s.network.mode === "new" && !s.networkCreated && !matchesName(s.typedNetwork, s.network.name)) blockers.push("typedNetwork");
  if (!s.ack) blockers.push("ack");
  return buildGate(blockers, plans.appPlans.find((p) => p.id === s.planId)?.hourlyToman, plans);
}

export function appReducer(s: AppWizardState, a: AppAction): AppWizardState {
  const busy = s.submit.phase === "pending";
  switch (a.type) {
    case "set_name":
      return { ...s, name: a.name, typedName: "", submit: IDLE };
    case "set_platform":
      return { ...s, platform: a.platform };
    case "set_plan":
      return { ...s, planId: a.planId, bundlePlanId: defaultBundle(a.planId, a.plans.bundlePlans) };
    case "set_bundle":
      return { ...s, bundlePlanId: a.bundlePlanId };
    case "set_network":
      return { ...s, network: a.network, typedNetwork: "", networkCreated: false };
    case "set_typed_name":
      return { ...s, typedName: a.typed };
    case "set_typed_network":
      return { ...s, typedNetwork: a.typed };
    case "set_ack":
      return { ...s, ack: a.ack };
    case "next": {
      if (s.step === "done" || s.step === "review" || !canAdvanceApp(s, a.plans)) return s;
      return { ...s, step: nextStep(APP_STEPS, s.step) };
    }
    case "back":
      return busy || s.step === "done" || s.step === "name"
        ? s
        : { ...s, step: prevStep(APP_STEPS, s.step), typedName: "", typedNetwork: "", ack: false, submit: IDLE };
    case "submit_start":
      return s.step === "review" && !busy ? { ...s, submit: { phase: "pending", stage: s.network.mode === "new" && !s.networkCreated ? "network" : "resource" } } : s;
    case "stage_network_done":
      return { ...s, networkCreated: true, submit: { phase: "pending", stage: "resource" } };
    case "submit_error":
      return { ...s, submit: { phase: "error", errorKey: a.errorKey, retryAfterSec: a.retryAfterSec } };
    case "submit_success":
      return { ...s, step: "done", submit: { phase: "success" } };
  }
}

/* ---------------------------------------------------------------- database */

export const DB_STEPS = ["engine", "plan", "settings", "review"] as const;
export type DbStep = (typeof DB_STEPS)[number] | "done";

export interface DbWizardState {
  step: DbStep;
  engine?: string;
  version?: string;
  planId?: string;
  bundlePlanId?: string;
  name: string;
  network: NetworkChoice;
  networkCreated: boolean;
  publicNetwork: boolean;
  /** The user acknowledged that a public database is reachable from the internet. */
  publicAck: boolean;
  typedName: string;
  typedNetwork: string;
  ack: boolean;
  submit: SubmitState;
}

export const initialDbState = (network?: string): DbWizardState => ({
  step: "engine",
  name: "",
  network: network ? { mode: "existing", name: network } : { mode: "none" },
  networkCreated: false,
  publicNetwork: false,
  publicAck: false,
  typedName: "",
  typedNetwork: "",
  ack: false,
  submit: IDLE,
});

export type DbAction =
  | { type: "set_engine"; engine: string; plans: PlansResponse }
  | { type: "set_version"; version: string }
  | { type: "set_plan"; planId: string; plans: PlansResponse }
  | { type: "set_bundle"; bundlePlanId: string }
  | { type: "set_name"; name: string }
  | { type: "set_network"; network: NetworkChoice }
  | { type: "set_public"; value: boolean }
  | { type: "set_public_ack"; value: boolean }
  | { type: "set_typed_name"; typed: string }
  | { type: "set_typed_network"; typed: string }
  | { type: "set_ack"; ack: boolean }
  | { type: "next"; plans: PlansResponse }
  | { type: "back" }
  | { type: "submit_start" }
  | { type: "stage_network_done" }
  | { type: "submit_error"; errorKey: ErrorKey; retryAfterSec?: number }
  | { type: "submit_success" };

export function dbEngines(plans: PlansResponse, all: readonly string[]): string[] {
  return all.filter((e) => (plans.dbVersions[e]?.length ?? 0) > 0);
}

export function canAdvanceDb(s: DbWizardState, plans: PlansResponse): boolean {
  switch (s.step) {
    case "engine":
      return !!s.engine && !!s.version && !!plans.dbVersions[s.engine]?.some((v) => v.value === s.version);
    case "plan": {
      const plan = dbPlansFor(plans, s.engine).find((p) => p.id === s.planId);
      return !!plan && isSelectable(plan) && bundleOk(s.planId, s.bundlePlanId, plans.dbBundlePlans);
    }
    case "settings":
      return validateDbName(s.name) === null && networkChoiceValid(s.network, plans) && (!s.publicNetwork || s.publicAck);
    default:
      return false;
  }
}

export function dbReviewGate(s: DbWizardState, plans: PlansResponse): ReviewGate {
  const blockers: ReviewBlocker[] = [];
  const valid =
    canAdvanceDb({ ...s, step: "engine" }, plans) && canAdvanceDb({ ...s, step: "plan" }, plans) && canAdvanceDb({ ...s, step: "settings" }, plans);
  if (!valid) blockers.push("invalid");
  if (!matchesName(s.typedName, s.name)) blockers.push("typedName");
  if (s.network.mode === "new" && !s.networkCreated && !matchesName(s.typedNetwork, s.network.name)) blockers.push("typedNetwork");
  if (!s.ack) blockers.push("ack");
  return buildGate(blockers, dbPlansFor(plans, s.engine).find((p) => p.id === s.planId)?.hourlyToman, plans);
}

export function dbReducer(s: DbWizardState, a: DbAction): DbWizardState {
  const busy = s.submit.phase === "pending";
  switch (a.type) {
    case "set_engine": {
      const versions = a.plans.dbVersions[a.engine] ?? [];
      const def = a.plans.defaultDbVersions[a.engine];
      const version = versions.find((v) => v.value === def)?.value ?? versions[0]?.value;
      const stillOk = dbPlansFor(a.plans, a.engine).some((p) => p.id === s.planId);
      return { ...s, engine: a.engine, version, ...(stillOk ? {} : { planId: undefined, bundlePlanId: undefined }) };
    }
    case "set_version":
      return { ...s, version: a.version };
    case "set_plan":
      return { ...s, planId: a.planId, bundlePlanId: defaultBundle(a.planId, a.plans.dbBundlePlans) };
    case "set_bundle":
      return { ...s, bundlePlanId: a.bundlePlanId };
    case "set_name":
      return { ...s, name: a.name, typedName: "", submit: IDLE };
    case "set_network":
      return { ...s, network: a.network, typedNetwork: "", networkCreated: false };
    case "set_public":
      return { ...s, publicNetwork: a.value, publicAck: a.value ? s.publicAck : false };
    case "set_public_ack":
      return { ...s, publicAck: a.value };
    case "set_typed_name":
      return { ...s, typedName: a.typed };
    case "set_typed_network":
      return { ...s, typedNetwork: a.typed };
    case "set_ack":
      return { ...s, ack: a.ack };
    case "next": {
      if (s.step === "done" || s.step === "review" || !canAdvanceDb(s, a.plans)) return s;
      return { ...s, step: nextStep(DB_STEPS, s.step) };
    }
    case "back":
      return busy || s.step === "done" || s.step === "engine"
        ? s
        : { ...s, step: prevStep(DB_STEPS, s.step), typedName: "", typedNetwork: "", ack: false, submit: IDLE };
    case "submit_start":
      return s.step === "review" && !busy ? { ...s, submit: { phase: "pending", stage: s.network.mode === "new" && !s.networkCreated ? "network" : "resource" } } : s;
    case "stage_network_done":
      return { ...s, networkCreated: true, submit: { phase: "pending", stage: "resource" } };
    case "submit_error":
      return { ...s, submit: { phase: "error", errorKey: a.errorKey, retryAfterSec: a.retryAfterSec } };
    case "submit_success":
      return { ...s, step: "done", submit: { phase: "success" } };
  }
}

/* ------------------------------------------------------------------ deploy */

export const DEPLOY_STEPS = ["source", "config", "review", "progress"] as const;
export type DeployStep = (typeof DEPLOY_STEPS)[number];
export type SourceKind = "archive" | "image";

export interface SourceFile {
  name: string;
  size: number;
  blob?: Blob;
}

export interface DeployWizardState {
  step: DeployStep;
  appName: string;
  sourceKind: SourceKind;
  file?: SourceFile;
  image: string;
  platform: string;
  port: string;
  portTouched: boolean;
  typedName: string;
  submit: SubmitState;
  releaseId?: string;
}

export const initialDeployState = (appName: string, platformHint?: string): DeployWizardState => ({
  step: "source",
  appName,
  sourceKind: "archive",
  image: "",
  platform: platformHint ?? "node",
  port: String(suggestPort(platformHint ?? "node") ?? ""),
  portTouched: false,
  typedName: "",
  submit: IDLE,
});

export type FileProblem = "type" | "tooLarge" | "empty";

export function fileProblem(f: SourceFile): FileProblem | null {
  if (!archiveKindFromName(f.name)) return "type";
  if (f.size <= 0) return "empty";
  return f.size > MAX_UPLOAD_BYTES ? "tooLarge" : null;
}

export type DeployAction =
  | { type: "set_kind"; kind: SourceKind }
  | { type: "set_file"; file: SourceFile | undefined }
  | { type: "set_image"; image: string }
  | { type: "set_platform"; platform: string }
  | { type: "set_port"; port: string }
  | { type: "set_typed"; typed: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "submit_start" }
  | { type: "submit_error"; errorKey: ErrorKey; retryAfterSec?: number }
  | { type: "submit_success"; releaseId: string }
  /** From the progress step: go back to the review step for another attempt. */
  | { type: "restart" };

export function canAdvanceDeploy(s: DeployWizardState, platforms: readonly string[]): boolean {
  switch (s.step) {
    case "source":
      return s.sourceKind === "archive" ? !!s.file && fileProblem(s.file) === null : validateImage(s.image) === null;
    case "config":
      return validatePort(s.port) === null && (s.sourceKind === "image" || platforms.includes(s.platform));
    default:
      return false;
  }
}

export const deployTypedOk = (s: DeployWizardState): boolean => matchesName(s.typedName, s.appName);

export function deployReducer(s: DeployWizardState, a: DeployAction): DeployWizardState {
  const busy = s.submit.phase === "pending";
  switch (a.type) {
    case "set_kind":
      return { ...s, sourceKind: a.kind };
    case "set_file":
      return { ...s, file: a.file };
    case "set_image":
      return { ...s, image: a.image };
    case "set_platform": {
      const hint = suggestPort(a.platform);
      return { ...s, platform: a.platform, ...(!s.portTouched && hint ? { port: String(hint) } : {}) };
    }
    case "set_port":
      return { ...s, port: a.port.replace(/[^\d]/g, "").slice(0, 5), portTouched: true };
    case "set_typed":
      return { ...s, typedName: a.typed };
    case "next":
      return s.step === "progress" || s.step === "review" || !canAdvanceDeploy(s, PLATFORMS) ? s : { ...s, step: nextStep(DEPLOY_STEPS, s.step) };
    case "back":
      return busy || s.step === "source" || s.step === "progress" ? s : { ...s, step: prevStep(DEPLOY_STEPS, s.step), typedName: "", submit: IDLE };
    case "submit_start":
      return s.step === "review" && deployTypedOk(s) && !busy ? { ...s, submit: { phase: "pending" } } : s;
    case "submit_error":
      return { ...s, submit: { phase: "error", errorKey: a.errorKey, retryAfterSec: a.retryAfterSec } };
    case "submit_success":
      return { ...s, step: "progress", releaseId: a.releaseId, submit: { phase: "success" } };
    case "restart":
      return s.step === "progress" ? { ...s, step: "review", releaseId: undefined, typedName: "", submit: IDLE } : s;
  }
}
