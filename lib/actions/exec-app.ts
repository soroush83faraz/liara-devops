// Executors for runtime operations on an existing app or database: restart, scale, update_port, resize.
import { getApp, resizeApp, resizeDatabase, restartApp, scaleApp, scaleDatabase, updateAppPort, type LiaraClient } from "@/lib/liara";
import type { ActionParamsOf } from "@/lib/contracts/action";
import { ActionError } from "./errors";
import { findDatabase, resolveDatabase } from "./liara-refs";
import { mutateOnce } from "./mutate";
import { appPlans, assertPlanAvailable, costDelta, dbPlans, readMe } from "./plans";
import type { Run } from "./run";

export interface Outcome {
  summary: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Secret-free view of an app (never env values). */
export async function appAfter(liara: LiaraClient, name: string): Promise<Record<string, unknown>> {
  const app = await getApp(liara, name);
  return { status: app.status ?? null, scale: app.scale ?? null, planId: app.planID ?? null, envKeyCount: app.envs.length };
}

export async function execRestart(run: Run, p: ActionParamsOf<"restart">): Promise<Outcome> {
  run.step("restart", "running");
  // A restart cannot be proven from state, so an ambiguous failure always ends as outcome_unknown.
  await mutateOnce("restart", () => restartApp(run.liara, p.app), async () => ({ confirmed: false, after: await appAfter(run.liara, p.app) }));
  run.step("restart", "done");
  return { summary: { app: p.app, restartRequested: true } };
}

export async function execScale(run: Run, p: ActionParamsOf<"scale">): Promise<Outcome> {
  run.step("scale", "running", `scale=${p.scale}`);
  if (p.resource.kind === "app") {
    const name = p.resource.name;
    const r = await mutateOnce("scale", () => scaleApp(run.liara, name, p.scale), async () => {
      const after = await appAfter(run.liara, name);
      return { confirmed: after.scale === p.scale, after };
    });
    if (r.confirmedByReread) run.confirmedByReread = true;
  } else {
    const name = p.resource.name;
    const { ref } = await resolveDatabase(run.liara, name);
    const r = await mutateOnce("scale", () => scaleDatabase(run.liara, ref, p.scale), async () => {
      const db = await findDatabase(run.liara, name);
      return { confirmed: db?.summary.scale === p.scale, after: { exists: Boolean(db), scale: db?.summary.scale ?? null } };
    });
    if (r.confirmedByReread) run.confirmedByReread = true;
  }
  run.step("scale", "done");
  return { summary: { resource: p.resource, scale: p.scale } };
}

export async function execUpdatePort(run: Run, p: ActionParamsOf<"update_port">): Promise<Outcome> {
  run.step("update_port", "running", `port=${p.port}`);
  // [VAL] the app detail does not expose the port, so an ambiguous failure cannot be confirmed by re-reading.
  await mutateOnce("update_port", () => updateAppPort(run.liara, p.app, p.port), async () => ({ confirmed: false, after: await appAfter(run.liara, p.app) }));
  run.step("update_port", "done");
  return { summary: { app: p.app, port: p.port } };
}

export async function execResize(run: Run, p: ActionParamsOf<"resize">): Promise<Outcome> {
  const me = await readMe(run.liara);
  run.step("resize", "running", `plan=${p.planId}`);
  if (p.resource.kind === "app") {
    const name = p.resource.name;
    const app = await getApp(run.liara, name);
    // The resize endpoint takes only planID; a bundle change cannot be applied, so it is refused, not ignored.
    if (p.bundlePlanId !== undefined && p.bundlePlanId !== app.bundlePlanID) {
      throw new ActionError("unsupported", { details: { reason: "bundle_change", bundlePlanId: p.bundlePlanId } });
    }
    const plans = appPlans(me);
    assertPlanAvailable(plans, p.planId);
    const delta = costDelta(plans, app.planID, p.planId);
    const r = await mutateOnce("resize", () => resizeApp(run.liara, name, p.planId), async () => {
      const after = await appAfter(run.liara, name);
      return { confirmed: after.planId === p.planId, after };
    });
    if (r.confirmedByReread) run.confirmedByReread = true;
    run.step("resize", "done");
    return { summary: { resource: p.resource, from: app.planID ?? null, to: p.planId, costDelta: delta } };
  }
  const name = p.resource.name;
  const db = await resolveDatabase(run.liara, name);
  if (p.bundlePlanId !== undefined && p.bundlePlanId !== db.summary.bundlePlanID) {
    throw new ActionError("unsupported", { details: { reason: "bundle_change", bundlePlanId: p.bundlePlanId } });
  }
  const plans = dbPlans(me, db.summary.type);
  assertPlanAvailable(plans, p.planId);
  const delta = costDelta(plans, db.summary.planID, p.planId);
  const r = await mutateOnce("resize", () => resizeDatabase(run.liara, db.ref, p.planId), async () => {
    const now = await findDatabase(run.liara, name);
    return { confirmed: now?.summary.planID === p.planId, after: { exists: Boolean(now), planId: now?.summary.planID ?? null } };
  });
  if (r.confirmedByReread) run.confirmedByReread = true;
  run.step("resize", "done");
  return { summary: { resource: p.resource, from: db.summary.planID ?? null, to: p.planId, costDelta: delta } };
}
