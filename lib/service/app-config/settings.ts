// Pure helpers for the settings tab: port parsing, toggle metadata/state, power state.
import type { AppToggleId, SettingsDto } from "./dto";

export function parsePort(input: string): { ok: true; port: number } | { ok: false } {
  const s = input.trim();
  if (!/^\d{1,5}$/.test(s)) return { ok: false };
  const n = Number(s);
  return n >= 1 && n <= 65535 ? { ok: true, port: n } : { ok: false };
}

export interface ToggleMeta {
  id: AppToggleId;
  /** Needs the app name typed (paid / address-changing). */
  typed: boolean;
}

export const TOGGLES: readonly ToggleMeta[] = [
  { id: "zero-downtime", typed: false },
  { id: "default-subdomain", typed: false },
  { id: "fixed-ip", typed: true },
  { id: "read-only", typed: false },
];

/** Fixed-IP status strings are unverified [VAL]; anything unrecognised is «unknown», never guessed. */
export function fixedIpEnabled(status: string | undefined): boolean | undefined {
  if (!status) return undefined;
  const s = status.trim().toLowerCase();
  if (["active", "enabled", "enable", "on", "true"].includes(s)) return true;
  if (["inactive", "disabled", "disable", "off", "false", "none"].includes(s)) return false;
  return undefined;
}

/** Current on/off state of a toggle, or undefined when Liara did not tell us. */
export function toggleState(id: AppToggleId, s: Pick<SettingsDto, "zeroDowntime" | "defaultSubdomain" | "readOnlyRootFilesystem" | "fixedIPStatus">): boolean | undefined {
  switch (id) {
    case "zero-downtime":
      return s.zeroDowntime;
    case "default-subdomain":
      return s.defaultSubdomain;
    case "read-only":
      return s.readOnlyRootFilesystem;
    case "fixed-ip":
      return fixedIpEnabled(s.fixedIPStatus);
  }
}

export type PowerState = "running" | "stopped" | "unknown";
export function powerState(s: Pick<SettingsDto, "scale">): PowerState {
  if (s.scale === 0) return "stopped";
  if (typeof s.scale === "number" && s.scale > 0) return "running";
  return "unknown";
}
