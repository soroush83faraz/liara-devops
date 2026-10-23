import { invalidArgument, type LiaraClient } from "./core";
import { getApp } from "./apps";
import { AnyBodySchema, type EnvVar } from "./schemas";

export interface EnvInput {
  key: string;
  value: string;
}
export type EnvOp = { op: "set"; key: string; value: string } | { op: "unset"; key: string };
export interface MaskedEnv {
  key: string;
  /** Constant placeholder, or "" for empty values. Never derived from the real value. */
  value: string;
  masked: true;
  encrypted?: boolean;
}

const KEY_RE = /^[^\s=\u0000-\u001f]{1,256}$/;
export function assertEnvKey(key: string): void {
  if (!KEY_RE.test(key)) throw invalidArgument(`Invalid env var name: ${JSON.stringify(key.slice(0, 40))}`);
}

/**
 * Pure read-merge step for `updateEnvs`. `set` updates in place (first
 * occurrence, later duplicates dropped) or appends; `unset` removes the key.
 * Every untouched variable is kept, in order. Inputs are not mutated.
 */
export function mergeEnvs(current: ReadonlyArray<EnvInput>, ops: ReadonlyArray<EnvOp>): EnvInput[] {
  let out: EnvInput[] = current.map(({ key, value }) => ({ key, value }));
  for (const op of ops) {
    assertEnvKey(op.key);
    if (op.op === "unset") {
      out = out.filter((e) => e.key !== op.key);
    } else {
      const first = out.findIndex((e) => e.key === op.key);
      if (first === -1) out.push({ key: op.key, value: op.value });
      else out = out.flatMap((e, i) => (e.key !== op.key ? [e] : i === first ? [{ key: e.key, value: op.value }] : []));
    }
  }
  return out;
}

/** Hide values for display/logging/LLM context. Keys stay visible. */
export function maskEnvs(envs: ReadonlyArray<Pick<EnvVar, "key" | "value" | "encrypted">>): MaskedEnv[] {
  return envs.map((e) => ({
    key: e.key,
    value: e.value ? "••••••••" : "",
    masked: true as const,
    ...(e.encrypted !== undefined ? { encrypted: e.encrypted } : {}),
  }));
}

/** Current variables of an app (values in clear: treat as secret). Read from the app detail [V]. */
export async function getEnvs(client: LiaraClient, app: string): Promise<EnvVar[]> {
  return (await getApp(client, app)).envs;
}

/**
 * [V] POST /v1/projects/update-envs {project, variables[]}. The list REPLACES
 * all variables (full-list semantics, unverified live [VAL]) and restarts the
 * app, so callers must pass the complete desired list; an empty list is
 * refused unless `allowEmpty`. Prefer `applyEnvOps`.
 */
export async function updateEnvs(
  client: LiaraClient,
  app: string,
  variables: ReadonlyArray<EnvInput>,
  opts: { allowEmpty?: boolean } = {},
): Promise<void> {
  if (variables.length === 0 && !opts.allowEmpty) throw invalidArgument("update-envs replaces all variables; refusing an empty list without allowEmpty");
  const seen = new Set<string>();
  for (const v of variables) {
    assertEnvKey(v.key);
    if (typeof v.value !== "string") throw invalidArgument(`Env var ${v.key} must have a string value`);
    if (seen.has(v.key)) throw invalidArgument(`Duplicate env var: ${v.key}`);
    seen.add(v.key);
  }
  await client.post("/v1/projects/update-envs", AnyBodySchema, {
    json: { project: app, variables: variables.map(({ key, value }) => ({ key, value })) },
  });
}

export interface ApplyEnvResult {
  /** Keys before / after (values intentionally omitted). */
  keysBefore: string[];
  keysAfter: string[];
  /** Keys that should exist after the change but did not come back on readback. */
  missingAfter: string[];
  /** Keys that should have been removed but are still present. */
  unexpectedAfter: string[];
  verified: boolean;
}

/** read -> mergeEnvs -> updateEnvs (full list) -> readback. Never reports success from API acceptance alone. */
export async function applyEnvOps(client: LiaraClient, app: string, ops: ReadonlyArray<EnvOp>): Promise<ApplyEnvResult> {
  const before = await getEnvs(client, app);
  const merged = mergeEnvs(before, ops);
  const mergedKeys = new Set(merged.map((e) => e.key));
  const dropped = before.filter((e) => !mergedKeys.has(e.key)).map((e) => e.key);
  const allowedDrops = new Set(ops.filter((o) => o.op === "unset").map((o) => o.key));
  if (dropped.some((k) => !allowedDrops.has(k))) throw invalidArgument("merge would drop variables that were not explicitly unset");
  await updateEnvs(client, app, merged, { allowEmpty: ops.some((o) => o.op === "unset") });
  const after = await getEnvs(client, app);
  const afterKeys = new Set(after.map((e) => e.key));
  const missingAfter = merged.filter((e) => !afterKeys.has(e.key)).map((e) => e.key);
  const unexpectedAfter = [...allowedDrops].filter((k) => afterKeys.has(k));
  return {
    keysBefore: before.map((e) => e.key),
    keysAfter: after.map((e) => e.key),
    missingAfter,
    unexpectedAfter,
    verified: missingAfter.length === 0 && unexpectedAfter.length === 0,
  };
}
