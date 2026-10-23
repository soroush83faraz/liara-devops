import { createHash } from "node:crypto";

export interface Identity {
  accountId: string;
  userName?: string;
  /** Team mode only (a team id was supplied and `GET /v1/me` has a `team` object). */
  teamName?: string;
  teamMemberRole?: string;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** First 16 hex chars of sha256(value). */
export function hashAccountId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Derive a stable, non-reversible account id and a display name from Liara's `GET /v1/me` body.
 * The response shape is not fully verified, so several likely locations are tried. Returns null when
 * nothing identifies the account (caller reports an unreadable response; the token is never used as identity).
 *
 * Team mode (`teamId` supplied): `user` is still the person, but the resources, caches, proposals and layouts belong
 * to the team, so the team id is part of the hashed input. The personal account and every team therefore get
 * different account ids, and the personal id is unchanged (same input as before).
 */
export function deriveIdentity(me: unknown, teamId?: string): Identity | null {
  const root = asObject(me);
  if (!root) return null;
  const user = asObject(root.user) ?? asObject(root.data) ?? root;
  const stable = firstString(user.id, user._id, user.email, root.id, root._id, root.email, user.username);
  if (!stable) return null;
  const userName = firstString(user.fullname, user.fullName, user.name, user.username, user.email, root.fullname, root.name);
  const team = teamId ? asObject(root.team) : null;
  const teamName = firstString(team?.teamName);
  const teamMemberRole = firstString(team?.teamMemberRole);
  const scope = teamId ? `${stable.toLowerCase()}\u0000team:${teamId.trim()}` : stable.toLowerCase();
  return {
    accountId: hashAccountId(scope),
    ...(userName ? { userName } : {}),
    ...(teamName ? { teamName } : {}),
    ...(teamMemberRole ? { teamMemberRole } : {}),
  };
}
