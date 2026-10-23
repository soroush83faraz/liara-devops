// Final redaction gate: everything that leaves the evidence module passes through lib/security/redact.
import { createRedactor, selectKnownSecrets, type Redactor } from "@/lib/security/redact";
import type { EvidenceBundle, Observation } from "./types";

export interface RedactionInput {
  /** Exact secret values to scrub (token, DB password, ...). */
  knownSecrets?: readonly string[];
  /**
   * App env pairs. Values are used ONLY to build the exact-match scrub list and are never stored or
   * returned; only key names leave this module.
   */
  envs?: ReadonlyArray<{ key: string; value?: unknown }>;
}

export function buildRedactor(input: RedactionInput = {}): Redactor {
  const knownSecrets = selectKnownSecrets({ envs: input.envs ? [...input.envs] : undefined, values: input.knownSecrets ? [...input.knownSecrets] : undefined });
  return createRedactor({ knownSecrets });
}

/** Redacts one observation (text, params, every string). Ids, kinds and numbers are untouched. */
export function redactObservation(o: Observation, r: Redactor): Observation {
  return { ...o, text: r.string(o.text), params: r.deep(o.params) };
}

/**
 * Redacts a whole bundle: observations, raw data, timeline, unknowns and limits. Idempotent, so applying it
 * to text that was already redacted line by line is safe.
 */
export function redactBundle(bundle: EvidenceBundle, r: Redactor): EvidenceBundle {
  return {
    ...bundle,
    raw: r.deep(bundle.raw),
    observations: bundle.observations.map((o) => redactObservation(o, r)),
    timeline: r.deep(bundle.timeline),
    unknowns: r.deep(bundle.unknowns),
    limits: bundle.limits.map((l) => r.string(l)),
  };
}
