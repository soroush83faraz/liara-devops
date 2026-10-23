// Applies env ops with lib/liara `applyEnvOps` (read -> merge -> write the FULL list -> readback) plus a
// value-level readback compared in memory. Values are never reported: only key names and counts.
import { applyEnvOps, getEnvs, mergeEnvs, type EnvOp, type EnvVar } from "@/lib/liara";
import { selectKnownSecrets } from "@/lib/security/redact";
import { ActionError } from "./errors";
import { mutateOnce } from "./mutate";
import type { Run } from "./run";

// Shapes a masked value could take if Liara ever returns encrypted variables masked [VAL].
const MASK_RE = /^(?:[*•●]+|x{6,}|«redacted»|\[redacted\]|\[hidden\]|<hidden>|<redacted>)$/i;

/**
 * The update endpoint replaces ALL variables. Writing back a masked encrypted value would silently destroy the
 * real secret, so refuse when any encrypted variable came back empty or masked.
 */
export function assertNoMaskedEncrypted(envs: readonly EnvVar[]): void {
  const masked = envs.filter((e) => e.encrypted === true && (e.value === "" || MASK_RE.test(e.value))).map((e) => e.key);
  if (masked.length > 0) throw new ActionError("encrypted_env_masked", { details: { keys: masked } });
}

export interface EnvComparison {
  ok: boolean;
  missing: string[];
  stillPresent: string[];
  valueMismatch: string[];
}

/** `actual` must hold every intended key with the intended value, and none of the unset keys. */
export function compareEnvs(actual: readonly { key: string; value: string }[], intended: readonly { key: string; value: string }[], unset: readonly string[]): EnvComparison {
  const a = new Map(actual.map((e) => [e.key, e.value]));
  const missing = intended.filter((e) => !a.has(e.key)).map((e) => e.key);
  const valueMismatch = intended.filter((e) => a.has(e.key) && a.get(e.key) !== e.value).map((e) => e.key);
  const stillPresent = unset.filter((k) => a.has(k));
  return { ok: missing.length === 0 && valueMismatch.length === 0 && stillPresent.length === 0, missing, stillPresent, valueMismatch };
}

export interface EnvApplyResult {
  changed: boolean;
  keysBefore: number;
  keysAfter: number;
}

const sameList = (x: readonly { key: string; value: string }[], y: readonly { key: string; value: string }[]) =>
  x.length === y.length && x.every((e, i) => e.key === y[i].key && e.value === y[i].value);

export async function applyEnvChanges(run: Run, app: string, before: readonly EnvVar[], ops: readonly EnvOp[], prefix = ""): Promise<EnvApplyResult> {
  run.secrets.addAll(selectKnownSecrets({ envs: before }));
  assertNoMaskedEncrypted(before);
  const intended = mergeEnvs(before, ops);
  const unset = ops.filter((o) => o.op === "unset").map((o) => o.key);
  const current = before.map(({ key, value }) => ({ key, value }));
  if (sameList(current, intended)) {
    run.step(`${prefix}apply_envs`, "skipped", "no_change");
    return { changed: false, keysBefore: before.length, keysAfter: before.length };
  }

  const setCount = ops.filter((o) => o.op === "set").length;
  run.step(`${prefix}apply_envs`, "running", `set=${setCount} unset=${unset.length}`);
  const sent = await mutateOnce("apply_envs", () => applyEnvOps(run.liara, app, ops), async () => {
    const now = await getEnvs(run.liara, app);
    run.secrets.addAll(selectKnownSecrets({ envs: now }));
    return { confirmed: compareEnvs(now, intended, unset).ok, after: { envKeys: now.map((e) => e.key) } };
  });
  if (sent.confirmedByReread) run.confirmedByReread = true;
  run.step(`${prefix}apply_envs`, "done");

  run.step(`${prefix}readback`, "running");
  const after = await getEnvs(run.liara, app);
  run.secrets.addAll(selectKnownSecrets({ envs: after }));
  const cmp = compareEnvs(after, intended, unset);
  const libVerified = sent.value ? sent.value.verified : true;
  if (!cmp.ok || !libVerified) {
    run.step(`${prefix}readback`, "failed", `missing=${cmp.missing.length} mismatch=${cmp.valueMismatch.length}`);
    throw new ActionError("readback_mismatch", {
      details: { app, missing: cmp.missing, stillPresent: cmp.stillPresent, valueMismatch: cmp.valueMismatch },
      after: { envKeys: after.map((e) => e.key) },
    });
  }
  run.step(`${prefix}readback`, "done", `keys=${after.length}`);
  return { changed: true, keysBefore: before.length, keysAfter: after.length };
}
