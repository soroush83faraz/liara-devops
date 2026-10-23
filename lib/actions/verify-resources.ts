// Verification of database state, created resources and deletions (bounded polling, real reads only).
import { getApp, getEnvs, listDisks, listNetworks, type LiaraClient } from "@/lib/liara";
import type { ActionParamsOf } from "@/lib/contracts/action";
import { findDatabase, findDomain, isNotFound } from "./liara-refs";
import type { VerifyEnv } from "./verify-app";
import { pollUntil, type Checks } from "./verify-support";

const RUNNING = /^running$/i;

export async function verifyDbState(env: VerifyEnv, name: string, exp: { scale?: 0 | 1; planId?: string }, checks: Checks): Promise<void> {
  const want = (db: NonNullable<Awaited<ReturnType<typeof findDatabase>>>) => {
    const s = db.summary;
    if (exp.scale === 0) return s.scale === 0 && !RUNNING.test(s.status ?? "");
    const scaleOk = exp.scale === undefined || s.scale === exp.scale;
    const planOk = exp.planId === undefined || s.planID === exp.planId;
    return scaleOk && planOk && RUNNING.test(s.status ?? "");
  };
  const r = await pollUntil(env.clock, env.deadline, env.pollMs, env.signal, () => findDatabase(env.liara, name), (db) => db === undefined || want(db));
  if (r.reads === 0) {
    checks.add("state_readable", false, `database state could not be read (${r.lastErrorKind ?? "error"})`, true);
    return;
  }
  const db = r.last;
  if (!db) {
    checks.add("resource_exists", false, "the database was not found", true);
    return;
  }
  const s = db.summary;
  checks.add("db_state", want(db), `status ${s.status ?? "unknown"}, scale ${s.scale ?? "unknown"}, plan ${s.planID ?? "unknown"}`);
}

export async function verifyAppCreated(env: VerifyEnv, p: Pick<ActionParamsOf<"create_app">, "name" | "planId" | "platform">, checks: Checks): Promise<void> {
  const r = await pollUntil(env.clock, env.deadline, env.pollMs, env.signal, () => getApp(env.liara, p.name), () => true, { stopOnNotFound: false });
  if (!r.last) {
    checks.add("resource_exists", false, r.lastErrorKind === "not_found" ? "the app does not exist" : `the app could not be read (${r.lastErrorKind ?? "error"})`, true);
    return;
  }
  checks.add("resource_exists", true, "the app exists");
  if (r.last.planID !== undefined) checks.add("plan_matches", r.last.planID === p.planId, `plan is ${r.last.planID}`);
  if (r.last.type !== undefined) checks.add("platform_matches", r.last.type === p.platform, `platform is ${r.last.type}`);
}

export async function verifyDbCreated(env: VerifyEnv, p: Pick<ActionParamsOf<"create_db">, "name" | "planId">, checks: Checks): Promise<void> {
  const r = await pollUntil(env.clock, env.deadline, env.pollMs, env.signal, () => findDatabase(env.liara, p.name), (db) =>
    Boolean(db && RUNNING.test(db.summary.status ?? "")),
  );
  const db = r.last;
  if (!db) {
    checks.add("resource_exists", false, r.reads === 0 ? `the database could not be read (${r.lastErrorKind ?? "error"})` : "the database does not exist", true);
    return;
  }
  checks.add("resource_exists", true, `database ${p.name} exists`);
  checks.add("db_running", RUNNING.test(db.summary.status ?? ""), `database ${p.name} status ${db.summary.status ?? "unknown"}`);
  if (db.summary.planID !== undefined) checks.add("plan_matches", db.summary.planID === p.planId, `plan is ${db.summary.planID}`);
}

export async function verifyNetworkCreated(env: VerifyEnv, name: string, checks: Checks): Promise<void> {
  const r = await pollUntil(env.clock, env.deadline, env.pollMs, env.signal, () => listNetworks(env.liara), (list) => list.some((n) => n.name === name));
  checks.add("resource_exists", r.ok, r.ok ? "the network exists" : `the network was not found (${r.lastErrorKind ?? "absent"})`, !r.ok);
}

/** Polls until `exists()` is false. */
export async function verifyGone(env: VerifyEnv, what: string, exists: () => Promise<boolean>, checks: Checks): Promise<void> {
  const r = await pollUntil(env.clock, env.deadline, env.pollMs, env.signal, exists, (present) => !present);
  if (r.reads === 0) {
    checks.add("state_readable", false, `${what} state could not be read (${r.lastErrorKind ?? "error"})`);
    return;
  }
  checks.add("resource_gone", r.ok, r.ok ? `${what} no longer exists` : `${what} still exists`);
}

export function existsProbe(liara: LiaraClient, p: ActionParamsOf<"delete_app" | "delete_db" | "delete_domain" | "delete_disk">): () => Promise<boolean> {
  switch (p.type) {
    case "delete_app":
      return async () => {
        try {
          await getApp(liara, p.app);
          return true;
        } catch (e) {
          if (isNotFound(e)) return false;
          throw e;
        }
      };
    case "delete_db":
      return async () => Boolean(await findDatabase(liara, p.db));
    case "delete_domain":
      return async () => Boolean(await findDomain(liara, p.domain));
    case "delete_disk":
      return async () => (await listDisks(liara, p.app)).disks.some((d) => d.name === p.disk);
  }
}

/** Env keys that must exist (set) or be gone (unset) after a change; keys only, values never read out. */
export async function verifyEnvKeys(env: VerifyEnv, app: string, present: readonly string[], absent: readonly string[], checks: Checks): Promise<void> {
  if (present.length === 0 && absent.length === 0) return;
  try {
    const keys = new Set((await getEnvs(env.liara, app)).map((e) => e.key));
    const missing = present.filter((k) => !keys.has(k));
    const lingering = absent.filter((k) => keys.has(k));
    const ok = missing.length === 0 && lingering.length === 0;
    const parts = [ok ? "all expected keys are in place" : "keys differ from the expected state"];
    if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if (lingering.length) parts.push(`still present: ${lingering.join(", ")}`);
    checks.add("env_keys_applied", ok, parts.join("; "));
  } catch (e) {
    const kind = (e as { kind?: unknown } | null)?.kind;
    checks.record("env_keys_applied", "unknown", `env keys could not be read (${typeof kind === "string" ? kind : "error"})`, { signal: "config" });
  }
}
