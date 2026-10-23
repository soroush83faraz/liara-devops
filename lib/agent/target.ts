// Target resolution: the body's target or a name mentioned in the text, always validated against the
// caller's own apps/databases. Ambiguity is returned to the caller (who asks the user), never guessed.
import { AppNameSchema, DbNameSchema } from "@/lib/contracts/common";
import { databaseRef, listApps, listDatabases, type LiaraClient } from "@/lib/liara";
import { normalizeText } from "./route-intent";

export interface ResolvedTarget {
  kind: "app" | "db";
  name: string;
  /** Liara id of a database, when known. */
  dbRef?: string;
}

export type TargetResolution =
  | { ok: true; target: ResolvedTarget; verified: boolean }
  | { ok: false; reason: "none" | "ambiguous" | "not_found" | "no_resources"; candidates?: string[] };

export interface TargetHint {
  kind: "app" | "db";
  name: string;
}

interface Inventory {
  apps: string[];
  dbs: Array<{ name: string; ref?: string }>;
}

async function inventory(liara: LiaraClient): Promise<Inventory | null> {
  const [apps, dbs] = await Promise.allSettled([listApps(liara), listDatabases(liara)]);
  if (apps.status === "rejected" && dbs.status === "rejected") return null;
  return {
    apps: apps.status === "fulfilled" ? apps.value.flatMap((a) => (a.project_id ? [a.project_id] : [])) : [],
    dbs: dbs.status === "fulfilled" ? dbs.value.flatMap((d) => (d.hostname ? [{ name: d.hostname, ref: databaseRef(d) }] : [])) : [],
  };
}

const TOKEN = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/g;

export async function resolveTarget(liara: LiaraClient, text: string, hint?: TargetHint): Promise<TargetResolution> {
  const inv = await inventory(liara);
  if (hint) {
    const valid = hint.kind === "app" ? AppNameSchema.safeParse(hint.name).success : DbNameSchema.safeParse(hint.name).success;
    if (!valid) return { ok: false, reason: "not_found" };
    // Listing unavailable: keep the (schema-valid) hint; the collectors report what they cannot read.
    if (!inv) return { ok: true, target: { kind: hint.kind, name: hint.name }, verified: false };
    if (hint.kind === "app" && inv.apps.includes(hint.name)) return { ok: true, target: { kind: "app", name: hint.name }, verified: true };
    const db = inv.dbs.find((d) => d.name === hint.name || d.ref === hint.name);
    if (hint.kind === "db" && db) return { ok: true, target: { kind: "db", name: db.name, ...(db.ref ? { dbRef: db.ref } : {}) }, verified: true };
    return { ok: false, reason: "not_found" };
  }
  if (!inv) return { ok: false, reason: "none" };
  if (inv.apps.length === 0 && inv.dbs.length === 0) return { ok: false, reason: "no_resources" };

  const tokens = new Set(normalizeText(text).match(TOKEN) ?? []);
  const apps = inv.apps.filter((a) => tokens.has(a));
  const dbs = inv.dbs.filter((d) => tokens.has(d.name));
  const hits = [...apps.map((name) => ({ kind: "app" as const, name })), ...dbs.map((d) => ({ kind: "db" as const, name: d.name, ...(d.ref ? { dbRef: d.ref } : {}) }))];
  if (hits.length === 1) return { ok: true, target: hits[0], verified: true };
  if (hits.length > 1) return { ok: false, reason: "ambiguous", candidates: hits.map((h) => h.name).slice(0, 6) };
  if (inv.apps.length === 1 && inv.dbs.length === 0) return { ok: true, target: { kind: "app", name: inv.apps[0] }, verified: true };
  return { ok: false, reason: "none", candidates: [...inv.apps, ...inv.dbs.map((d) => d.name)].slice(0, 6) };
}
