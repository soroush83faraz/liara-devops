// Pure validation for the disk forms (the server re-validates with the same rules).
import { DiskNameSchema } from "@/lib/contracts/common";
import { MAX_DISK_GB } from "./schemas";

export type DiskNameIssue = "empty" | "invalid";
export type DiskSizeIssue = "empty" | "not_integer" | "range" | "not_larger";

export function diskNameIssue(name: string): DiskNameIssue | null {
  if (name === "") return "empty";
  return DiskNameSchema.safeParse(name).success ? null : "invalid";
}

/** Whole GB between 1 and MAX_DISK_GB; for resize it must also be larger than the current size. */
export function diskSizeCheck(input: string, currentGb?: number): { ok: true; sizeGb: number } | { ok: false; issue: DiskSizeIssue } {
  const s = input.trim();
  if (s === "") return { ok: false, issue: "empty" };
  if (!/^\d{1,5}$/.test(s)) return { ok: false, issue: "not_integer" };
  const n = Number(s);
  if (n < 1 || n > MAX_DISK_GB) return { ok: false, issue: "range" };
  if (currentGb !== undefined && n <= currentGb) return { ok: false, issue: "not_larger" };
  return { ok: true, sizeGb: n };
}
