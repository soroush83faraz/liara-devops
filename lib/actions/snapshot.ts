// Before/after snapshots: a few observable, secret-free facts (never env values) for the verification card.
import { getApp, listApplets, listNetworks, listReleases, type Applet, type LiaraClient } from "@/lib/liara";
import { actionTarget, type ActionParams } from "@/lib/contracts/action";
import type { Snapshot } from "@/lib/contracts/proposal";
import { redactDeep } from "@/lib/security/redact";
import { findDatabase, isNotFound } from "./liara-refs";

type Value = string | number | boolean | null;

const RUNNING = /^(?:running|ready)$/i;
export const isAppletRunning = (a: Applet) => RUNNING.test(a.state ?? "");

const s = (v: string | undefined) => (v === undefined ? null : v.slice(0, 200));

function errCode(e: unknown): string {
  const kind = (e as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" && /^[a-z_]{1,32}$/.test(kind) ? kind : "error";
}

export async function captureAppSnapshot(liara: LiaraClient, app: string, now: number): Promise<Snapshot> {
  const out: Record<string, Value> = { capturedAt: new Date(now).toISOString() };
  try {
    const a = await getApp(liara, app);
    Object.assign(out, { exists: true, status: s(a.status), scale: a.scale ?? null, planId: s(a.planID), envKeyCount: a.envs.length });
  } catch (e) {
    if (isNotFound(e)) return { ...out, exists: false };
    out.readError = errCode(e);
  }
  try {
    const applets = await listApplets(liara, app);
    out.appletsTotal = applets.length;
    out.appletsRunning = applets.filter(isAppletRunning).length;
    out.appletNames = applets.map((x) => x.name ?? "").filter(Boolean).join(",").slice(0, 500);
  } catch {
    out.appletsTotal = null;
  }
  try {
    const r = await listReleases(liara, app, { page: 1, count: 1 });
    out.currentReleaseId = s(r.currentRelease);
    out.latestReleaseId = s(r.releases[0]?._id);
    out.latestReleaseState = s(r.releases[0]?.state);
  } catch {
    out.latestReleaseId = null;
  }
  return redactDeep(out);
}

export async function captureDbSnapshot(liara: LiaraClient, name: string, now: number): Promise<Snapshot> {
  const out: Record<string, Value> = { capturedAt: new Date(now).toISOString() };
  try {
    const db = await findDatabase(liara, name);
    if (!db) return { ...out, exists: false };
    Object.assign(out, { exists: true, status: s(db.summary.status), scale: db.summary.scale ?? null, planId: s(db.summary.planID) });
  } catch (e) {
    out.readError = errCode(e);
  }
  return redactDeep(out);
}

/** Best-effort snapshot of the action's target; never throws. */
export async function captureSnapshot(liara: LiaraClient, params: ActionParams, now: number): Promise<Snapshot> {
  const target = actionTarget(params);
  try {
    if (target.kind === "app") return await captureAppSnapshot(liara, target.name, now);
    if (target.kind === "db") return await captureDbSnapshot(liara, target.name, now);
    if (target.kind === "network") {
      const exists = (await listNetworks(liara)).some((n) => n.name === target.name);
      return { capturedAt: new Date(now).toISOString(), exists };
    }
  } catch (e) {
    return { capturedAt: new Date(now).toISOString(), readError: errCode(e) };
  }
  return { capturedAt: new Date(now).toISOString() };
}
