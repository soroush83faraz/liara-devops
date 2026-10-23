import { createLiaraClient, type LiaraClient } from "../../lib/liara";
import { GuardError } from "./args";

export type Env = Readonly<Record<string, string | undefined>>;

export const EXIT = { ok: 0, usage: 1, guard: 2, liara: 3 } as const;

/**
 * Builds the client from LIARA_API_TOKEN / LIARA_TEAM_ID in the PROCESS environment only
 * (no file is read here; load .env with `node --env-file=.env`, see the usage text).
 * Refuses to run without a token.
 */
export function liaraFromEnv(env: Env = process.env, extra: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): LiaraClient {
  const token = (env.LIARA_API_TOKEN ?? "").trim();
  if (!token) throw new GuardError("LIARA_API_TOKEN is not set (export it, or run with: npx tsx --env-file=.env <script>)");
  return createLiaraClient({ token, teamId: (env.LIARA_TEAM_ID ?? "").trim(), timeoutMs: extra.timeoutMs ?? 30_000, fetchImpl: extra.fetchImpl });
}

export const hasToken = (env: Env): boolean => (env.LIARA_API_TOKEN ?? "").trim().length > 0;

/** Billed resources (creating an app) need the explicit --create flag AND ALLOW_BILLED_LIVE_TESTS=1. */
export function confirmBilled(flags: { create: boolean }, env: Env): void {
  if (!flags.create) throw new GuardError("creating a billed resource requires --create");
  if (env.ALLOW_BILLED_LIVE_TESTS !== "1") throw new GuardError("refusing to create a billed resource: set ALLOW_BILLED_LIVE_TESTS=1 to allow it");
}

export const billedAllowed = (flags: { create: boolean }, env: Env): boolean => flags.create && env.ALLOW_BILLED_LIVE_TESTS === "1";
