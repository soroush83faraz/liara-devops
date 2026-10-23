// Executors that create billed resources. Each: pre-check the name is free, validate plan (+ cost), resolve
// the network NAME to its id with a fresh read, check the balance, create once, refetch to confirm.
import { createApp, createDatabase, createNetwork, getApp, listNetworks, type AppDetail } from "@/lib/liara";
import type { ActionParamsOf } from "@/lib/contracts/action";
import { ActionError } from "./errors";
import type { Outcome } from "./exec-app";
import { findDatabase, isNotFound, resolveNetworkId } from "./liara-refs";
import { mutateOnce } from "./mutate";
import { appPlans, assertDbVersion, assertPriced, checkBalance, choosePlan, dbPlans, readMe } from "./plans";
import type { Run } from "./run";

export async function execCreateNetwork(run: Run, p: ActionParamsOf<"create_network">, prefix = ""): Promise<Outcome> {
  const exists = async () => (await listNetworks(run.liara)).find((n) => n.name === p.name);
  if (await exists()) throw new ActionError("conflict", { details: { resource: "network", name: p.name } });
  run.step(`${prefix}create_network`, "running", `name=${p.name}`);
  const r = await mutateOnce("create_network", () => createNetwork(run.liara, p.name), async () => ({ confirmed: Boolean(await exists()) }));
  if (r.confirmedByReread) run.confirmedByReread = true;
  const created = await exists();
  run.step(`${prefix}create_network`, "done");
  return { summary: { network: p.name }, after: { exists: Boolean(created), id: created?._id ?? null } };
}

async function appExists(run: Run, name: string): Promise<AppDetail | undefined> {
  try {
    return await getApp(run.liara, name);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

type CreateAppInput = Omit<ActionParamsOf<"create_app">, "type">;

export async function execCreateApp(run: Run, p: CreateAppInput, prefix = ""): Promise<Outcome> {
  if (await appExists(run, p.name)) throw new ActionError("conflict", { details: { resource: "app", name: p.name } });
  const me = await readMe(run.liara);
  const choice = choosePlan(appPlans(me), p.planId, p.bundlePlanId);
  assertPriced(choice);
  const networkId = p.network === undefined ? undefined : await resolveNetworkId(run.liara, p.network);
  const balance = await checkBalance(run.liara, choice.cost?.perHourToman);
  run.assertNotAborted();
  run.step(`${prefix}create_app`, "running", `name=${p.name} plan=${choice.planId}`);
  const r = await mutateOnce(
    "create_app",
    () =>
      createApp(run.liara, {
        name: p.name,
        planID: choice.planId,
        platform: p.platform,
        bundlePlanID: choice.bundlePlanId,
        network: networkId,
        readOnlyRootFilesystem: p.readOnlyRootFilesystem,
      }),
    async () => ({ confirmed: Boolean(await appExists(run, p.name)) }),
  );
  if (r.confirmedByReread) run.confirmedByReread = true;
  const app = r.value ?? (await appExists(run, p.name).catch(() => undefined));
  run.step(`${prefix}create_app`, "done");
  return {
    summary: {
      name: p.name,
      platform: p.platform,
      planId: choice.planId,
      bundlePlanId: choice.bundlePlanId,
      network: p.network ?? null,
      cost: choice.cost ?? null,
      bundleMonthlyToman: choice.bundleMonthlyToman ?? null,
      balanceChecked: balance.checked,
    },
    after: app
      ? { exists: true, planId: app.planID ?? null, platform: app.type ?? null, scale: app.scale ?? null, status: app.status ?? null }
      : { exists: "unknown" },
  };
}

type CreateDbInput = Omit<ActionParamsOf<"create_db">, "type">;

export async function execCreateDb(run: Run, p: CreateDbInput, prefix = ""): Promise<Outcome> {
  if (await findDatabase(run.liara, p.name)) throw new ActionError("conflict", { details: { resource: "db", name: p.name } });
  const me = await readMe(run.liara);
  const choice = choosePlan(dbPlans(me, p.engine), p.planId, p.bundlePlanId);
  assertPriced(choice);
  assertDbVersion(me, p.engine, p.version);
  const networkId = p.network === undefined ? undefined : await resolveNetworkId(run.liara, p.network);
  const balance = await checkBalance(run.liara, choice.cost?.perHourToman);
  run.assertNotAborted();
  run.step(`${prefix}create_db`, "running", `name=${p.name} engine=${p.engine}`);
  const r = await mutateOnce(
    "create_db",
    () =>
      createDatabase(run.liara, {
        hostname: p.name,
        type: p.engine,
        version: p.version,
        planID: choice.planId,
        bundlePlanID: choice.bundlePlanId,
        publicNetwork: p.publicNetwork,
        network: networkId,
      }),
    async () => ({ confirmed: Boolean(await findDatabase(run.liara, p.name)) }),
  );
  if (r.confirmedByReread) run.confirmedByReread = true;
  const db = await findDatabase(run.liara, p.name).catch(() => undefined);
  run.step(`${prefix}create_db`, "done");
  return {
    summary: {
      name: p.name,
      engine: p.engine,
      version: p.version,
      planId: choice.planId,
      bundlePlanId: choice.bundlePlanId,
      network: p.network ?? null,
      publicNetwork: p.publicNetwork,
      cost: choice.cost ?? null,
      bundleMonthlyToman: choice.bundleMonthlyToman ?? null,
      balanceChecked: balance.checked,
    },
    after: db ? { exists: true, status: db.summary.status ?? null, planId: db.summary.planID ?? null } : { exists: "unknown" },
  };
}
