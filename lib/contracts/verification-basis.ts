// Disclosed fallback bases of a verification check. The server puts the marker in the check's `detail` when a
// check was decided from a weaker or indirect source; the card shows the matching Persian disclosure.
// The marker never makes a check pass: it only explains how a (passed or not) verdict was reached.
export const VERIFY_BASIS_MARKERS = {
  /** restart_observed decided from Liara's container events because the instance list (applets) was unavailable. */
  events: "(via events)",
  /** app_running decided from the app detail + release state because the instance list (applets) was unavailable. */
  appDetail: "(via app detail)",
  /** set_env: the probes before the change failed and now succeed (a disclosed contrast, never a required check). */
  contrast: "(before/after contrast)",
} as const;

export type VerifyBasis = keyof typeof VERIFY_BASIS_MARKERS;

export function checkBasis(c: { detail?: unknown }): VerifyBasis | undefined {
  if (typeof c.detail !== "string") return undefined;
  for (const [k, marker] of Object.entries(VERIFY_BASIS_MARKERS) as Array<[VerifyBasis, string]>) {
    if (c.detail.includes(marker)) return k;
  }
  return undefined;
}
