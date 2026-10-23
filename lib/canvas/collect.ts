// Server-only: gathers the raw Liara data for the overview. Parsing/derivation lives in overview.ts (pure).
import { getAccountBilling, getApp, getDatabase, listApps, listDatabases, listNetworks, type LiaraClient } from "@/lib/liara";
import type { AppDetail, DatabaseDetail } from "@/lib/liara/schemas";
import { appName, buildOverview, dbRef, MAX_DB_DETAILS, MAX_ENV_APPS } from "./overview";
import type { Overview } from "./types";

type ErrorCode = "failed";

/** Never forward upstream messages: only a stable code the UI maps to Persian. */
const FAILED: ErrorCode = "failed";

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await p };
  } catch {
    return { ok: false };
  }
}

export async function collectOverview(liara: LiaraClient): Promise<Overview> {
  // The client itself caps concurrency (3) and retries reads; here we only start the independent lists together.
  const [apps, dbs, nets, bill] = await Promise.all([
    listApps(liara), // required: its failure fails the whole overview (surfaced by api())
    settle(listDatabases(liara)),
    settle(listNetworks(liara)),
    settle(getAccountBilling(liara)),
  ]);

  const errors: Overview["errors"] = {};
  if (!dbs.ok) errors.databases = FAILED;
  if (!nets.ok) errors.networks = FAILED;
  if (!bill.ok) errors.billing = FAILED;
  const databases = dbs.ok ? dbs.value : [];

  const appDetails = new Map<string, AppDetail | null>();
  const dbDetails = new Map<string, DatabaseDetail | null>();

  const appNames = apps.map(appName).filter((n): n is string => Boolean(n)).slice(0, MAX_ENV_APPS);
  const dbRefs = databases.map(dbRef).filter((r): r is string => Boolean(r)).slice(0, MAX_DB_DETAILS);

  await Promise.all([
    ...appNames.map(async (name) => {
      const r = await settle(getApp(liara, name));
      appDetails.set(name, r.ok ? r.value : null);
    }),
    ...dbRefs.map(async (ref) => {
      const r = await settle(getDatabase(liara, ref));
      dbDetails.set(ref, r.ok ? r.value : null);
    }),
  ]);

  return buildOverview({
    apps,
    appDetails,
    databases,
    dbDetails,
    networks: nets.ok ? nets.value : null,
    balance: bill.ok ? bill.value.balance : undefined,
    // A failed billing read in team mode is still TEAM mode: the chip must say the team balance is unreadable.
    balanceSource: bill.ok ? bill.value.source : liara.teamId ? "team" : undefined,
    balanceUnreadable: bill.ok ? bill.value.teamUnreadable : Boolean(liara.teamId),
    errors,
  });
}
