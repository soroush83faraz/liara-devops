// Shared by proposal creation (agent/setup) and confirm-time staleness checks (actions executor):
// both MUST call this same function so the fingerprints are comparable. Contains no secrets:
// env VALUES are never included, only key names.
//
// SECURITY decisions:
//  - The team context (`liara.teamId`) is part of the fingerprint: a proposal made under one team can never be
//    approved or executed while the session points at another team (or the personal account).
//  - A missing target is a state too (`exists:false`), so create proposals go stale if the name gets taken.
//  - Read failures throw instead of degrading to a partial fingerprint (fail closed: unknown state is not
//    "unchanged").
//  - Volatile health fields (status, applet states) are left out: a crash-looping app flips them every few
//    seconds, which would make every fix for it stale. Config that a proposal depends on is included.
import { getApp, listNetworks, listReleases, type AppDetail, type LiaraClient } from "@/lib/liara";
import { fingerprintState } from "@/lib/security/canonical";
import { findDatabase, isNotFound } from "./liara-refs";

export interface FingerprintTarget {
  kind: "app" | "db" | "network" | "domain" | "project" | "disk";
  name: string;
}

async function appOrUndefined(liara: LiaraClient, name: string): Promise<AppDetail | undefined> {
  try {
    return await getApp(liara, name);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

export async function computeTargetFingerprint(liara: LiaraClient, target: FingerprintTarget): Promise<string> {
  const base = { v: 2, kind: target.kind, name: target.name, team: liara.teamId ?? "" };
  if (target.kind === "app") {
    const app = await appOrUndefined(liara, target.name);
    if (!app) return fingerprintState({ ...base, exists: false });
    let currentRelease: string | null = null;
    try {
      currentRelease = (await listReleases(liara, target.name, { page: 1, count: 1 })).currentRelease ?? null;
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    return fingerprintState({
      ...base,
      exists: true,
      scale: app.scale ?? null,
      planID: app.planID ?? null,
      bundlePlanID: app.bundlePlanID ?? null,
      isDeployed: app.isDeployed ?? null,
      network: app.network?._id ?? app.network?.name ?? null,
      envKeys: [...new Set(app.envs.map((e) => e.key))].sort(),
      currentRelease,
    });
  }
  if (target.kind === "db") {
    const db = await findDatabase(liara, target.name);
    if (!db) return fingerprintState({ ...base, exists: false });
    const s = db.summary;
    return fingerprintState({
      ...base,
      exists: true,
      ref: db.ref,
      type: s.type ?? null,
      scale: s.scale ?? null,
      planID: s.planID ?? null,
      bundlePlanID: s.bundlePlanID ?? null,
      publicNetwork: s.publicNetwork ?? null,
    });
  }
  if (target.kind === "network") {
    const ids = (await listNetworks(liara)).filter((n) => n.name === target.name).map((n) => n._id ?? "").sort();
    return fingerprintState({ ...base, exists: ids.length > 0, ids });
  }
  // domain/project/disk targets are only touched by human ops (no proposal), so a name-level fingerprint is enough.
  return fingerprintState(base);
}
