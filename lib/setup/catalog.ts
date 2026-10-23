// What the user's Liara account can actually create (plans, DB versions, networks). Read-only calls via the
// session-bound client; the plan route re-reads this at build time, so the UI's copy is never trusted.
import { DB_ENGINES } from "@/lib/contracts";
import { getMe, listAppPlans, listDbPlans, listDbVersions, listNetworks, type LiaraClient, type NormalizedPlan, type DbVersions } from "@/lib/liara";
import { toOption, type PlanOption } from "./sizing";

export interface Catalog {
  appPlans: NormalizedPlan[];
  dbPlans: NormalizedPlan[];
  dbVersions: DbVersions[];
  networks: Array<{ _id: string; name: string }>;
  /** The networks list could not be read: `networks` is empty because of an error, not because there are none. */
  networksError?: true;
}

export async function loadCatalog(liara: LiaraClient): Promise<Catalog> {
  let networksError = false;
  const [me, networks] = await Promise.all([
    getMe(liara),
    listNetworks(liara).catch(() => {
      networksError = true;
      return [];
    }),
  ]);
  return {
    ...(networksError ? { networksError: true as const } : {}),
    appPlans: listAppPlans(me),
    dbPlans: listDbPlans(me),
    dbVersions: listDbVersions(me).filter((v) => (DB_ENGINES as readonly string[]).includes(v.engine) && v.versions.length > 0),
    networks: networks.flatMap((n) => (n._id && n.name ? [{ _id: n._id, name: n.name }] : [])),
  };
}

/** Browser-facing copy of the catalog: ids, sizes and prices only. */
export interface CatalogView {
  appPlans: PlanOption[];
  dbPlans: Array<PlanOption & { supports?: string[] }>;
  dbEngines: Array<{ engine: string; version: string }>;
  networks: Array<{ id: string; name: string }>;
  /** Networks could not be loaded (the list is not "no networks"). */
  networksError?: true;
}

export function toCatalogView(c: Catalog): CatalogView {
  return {
    ...(c.networksError ? { networksError: true as const } : {}),
    // Unpriced plans are not offered: the wizard cannot cost them and must never show them as free.
    appPlans: c.appPlans.filter((p) => p.available && p.priceKnown).map(toOption),
    dbPlans: c.dbPlans.filter((p) => p.available && p.priceKnown).map((p) => ({ ...toOption(p), supports: p.supports })),
    dbEngines: c.dbVersions.map((v) => ({ engine: v.engine, version: v.defaultVersion ?? v.versions[0].value })),
    networks: c.networks.map((n) => ({ id: n._id, name: n.name })),
  };
}
