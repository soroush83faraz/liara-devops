// Tier-3, human-only deletes. SECURITY: each executor asserts `source === 'user'` itself, so no caller (agent,
// setup, a future route) can reach a delete through a proposal even if a gate above is bypassed.
import { deleteApp, deleteDatabase, deleteDisk, getApp, listDisks, removeDomain } from "@/lib/liara";
import type { ActionParamsOf } from "@/lib/contracts/action";
import { ActionError } from "./errors";
import type { Outcome } from "./exec-app";
import { findDatabase, findDomain, isNotFound, resolveDatabase } from "./liara-refs";
import { mutateOnce } from "./mutate";
import type { Run } from "./run";

export function assertHumanOnly(run: Run, type: string): void {
  if (run.opts.source !== "user") throw new ActionError("human_only", { details: { type } });
}

async function appGone(run: Run, name: string): Promise<boolean> {
  try {
    await getApp(run.liara, name);
    return false;
  } catch (e) {
    if (isNotFound(e)) return true;
    throw e;
  }
}

export async function execDeleteApp(run: Run, p: ActionParamsOf<"delete_app">): Promise<Outcome> {
  assertHumanOnly(run, p.type);
  if (await appGone(run, p.app)) throw new ActionError("not_found", { details: { resource: "app", name: p.app } });
  run.step("delete", "running", `app=${p.app}`);
  const r = await mutateOnce("delete", () => deleteApp(run.liara, p.app), async () => ({ confirmed: await appGone(run, p.app) }));
  if (r.confirmedByReread) run.confirmedByReread = true;
  run.step("delete", "done");
  return { summary: { deleted: "app", name: p.app } };
}

/** The DB is addressed by its hostname (what the user typed); the Liara ref is resolved here. */
export async function execDeleteDb(run: Run, p: ActionParamsOf<"delete_db">): Promise<Outcome> {
  assertHumanOnly(run, p.type);
  const { ref } = await resolveDatabase(run.liara, p.db);
  run.step("delete", "running", `db=${p.db}`);
  const r = await mutateOnce("delete", () => deleteDatabase(run.liara, ref), async () => ({ confirmed: !(await findDatabase(run.liara, p.db)) }));
  if (r.confirmedByReread) run.confirmedByReread = true;
  run.step("delete", "done");
  return { summary: { deleted: "db", name: p.db } };
}

export async function execDeleteDomain(run: Run, p: ActionParamsOf<"delete_domain">): Promise<Outcome> {
  assertHumanOnly(run, p.type);
  const domain = await findDomain(run.liara, p.domain);
  const id = domain?._id;
  if (!id) throw new ActionError("not_found", { details: { resource: "domain", name: p.domain } });
  run.step("delete", "running", `domain=${p.domain}`);
  const r = await mutateOnce("delete", () => removeDomain(run.liara, id), async () => ({ confirmed: !(await findDomain(run.liara, p.domain)) }));
  if (r.confirmedByReread) run.confirmedByReread = true;
  run.step("delete", "done");
  return { summary: { deleted: "domain", name: p.domain } };
}

export async function execDeleteDisk(run: Run, p: ActionParamsOf<"delete_disk">): Promise<Outcome> {
  assertHumanOnly(run, p.type);
  const hasDisk = async () => (await listDisks(run.liara, p.app)).disks.some((d) => d.name === p.disk);
  if (!(await hasDisk())) throw new ActionError("not_found", { details: { resource: "disk", name: p.disk } });
  run.step("delete", "running", `disk=${p.disk}`);
  const r = await mutateOnce("delete", () => deleteDisk(run.liara, p.app, p.disk), async () => ({ confirmed: !(await hasDisk()) }));
  if (r.confirmedByReread) run.confirmedByReread = true;
  run.step("delete", "done");
  return { summary: { deleted: "disk", name: p.disk, app: p.app } };
}
