// Executors that change an app's environment: set_env, unset_env, wire_db. Summaries list key names only.
import { getApp } from "@/lib/liara";
import type { ActionParamsOf } from "@/lib/contracts/action";
import { DB_FIELDS, isExposedEnvKey, type DbField, type EnvChange } from "@/lib/contracts/env";
import { applyEnvChanges } from "./env-apply";
import { loadDbFields, resolveEnvChanges } from "./env-values";
import { ActionError } from "./errors";
import type { Outcome } from "./exec-app";
import type { Run } from "./run";

/** Shared by set_env and the deploy_plan `set_env` step. */
export async function applyChangeList(run: Run, app: string, changes: readonly EnvChange[], prefix = ""): Promise<Outcome> {
  run.step(`${prefix}resolve_values`, "running");
  const detail = await getApp(run.liara, app);
  const { ops, report } = await resolveEnvChanges(run, detail, changes);
  run.step(`${prefix}resolve_values`, "done", `set=${report.set.length} unset=${report.unset.length}`);
  run.assertNotAborted();
  const absent = report.unset.filter((k) => !detail.envs.some((e) => e.key === k));
  const r = await applyEnvChanges(run, app, detail.envs, ops, prefix);
  return {
    summary: {
      app,
      ...report,
      absent,
      keysBefore: r.keysBefore,
      keysAfter: r.keysAfter,
      readback: r.changed ? "ok" : "unchanged",
      // [V] update-envs restarts the app; nothing was sent when nothing changed.
      restartTriggered: r.changed,
    },
  };
}

export function execSetEnv(run: Run, p: ActionParamsOf<"set_env">): Promise<Outcome> {
  return applyChangeList(run, p.app, p.changes);
}

export function execUnsetEnv(run: Run, p: ActionParamsOf<"unset_env">): Promise<Outcome> {
  return applyChangeList(
    run,
    p.app,
    p.keys.map((key) => ({ op: "unset" as const, key })),
  );
}

/**
 * wire_db: host/port/user/password/database/url come from the DB detail server-side, only when app and DB
 * share a private network. The password reaches Liara and the secret set, never the summary or the model.
 */
export async function execWireDb(run: Run, p: ActionParamsOf<"wire_db">, prefix = ""): Promise<Outcome> {
  const fields = DB_FIELDS.filter((f): f is DbField => typeof p.mapping[f] === "string");
  for (const f of fields) {
    const key = p.mapping[f] as string;
    // Re-checked although the schema refines it: a database credential must never land in a client-exposed key.
    if (isExposedEnvKey(key)) throw new ActionError("public_key_forbidden", { details: { key } });
  }
  run.step(`${prefix}resolve_values`, "running", `db=${p.db}`);
  const app = await getApp(run.liara, p.app);
  const source = await loadDbFields(run.liara, app, p.db, run.secrets);
  const ops = fields.map((f) => {
    const value = source.values[f];
    if (value === undefined) throw new ActionError("env_source_missing", { details: { key: p.mapping[f] as string, from: `db:${p.db}.${f}` } });
    return { op: "set" as const, key: p.mapping[f] as string, value };
  });
  run.step(`${prefix}resolve_values`, "done", `fields=${fields.join(",")}`);
  run.assertNotAborted();
  const r = await applyEnvChanges(run, p.app, app.envs, ops, prefix);
  return {
    summary: {
      app: p.app,
      db: p.db,
      network: source.networkName ?? null,
      wired: fields.map((f) => ({ field: f, key: p.mapping[f] as string })),
      keysBefore: r.keysBefore,
      keysAfter: r.keysAfter,
      readback: r.changed ? "ok" : "unchanged",
      restartTriggered: r.changed,
    },
  };
}
