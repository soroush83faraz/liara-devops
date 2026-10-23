// Encrypted httpOnly session cookie (iron-session v9). The Liara token lives ONLY here, on the server.
// Never log the session and never return it from a route: use sessionPublicView().
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { fa } from "./i18n/fa";

export const SESSION_COOKIE = "hl_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export interface SessionData {
  /** Liara API key. Server-only. */
  token: string;
  teamId?: string;
  /** First 16 hex chars of sha256(user id/email). Stable across key rotations; used to key stored data. */
  accountId: string;
  userName?: string;
  /** Team mode: the team's display name and the person's role in it (from `GET /v1/me` at connect). */
  teamName?: string;
  teamMemberRole?: string;
}

/** What the browser is allowed to know. Deliberately has no token field. */
export interface SessionPublicView {
  connected: true;
  accountId: string;
  teamId?: string;
  userName?: string;
  teamName?: string;
  teamMemberRole?: string;
}

export type ValidSession = SessionData;

const globalKey = Symbol.for("hamyar.devSessionKey");

function resolvePassword(): string {
  const configured = process.env.APP_SESSION_KEY;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SESSION_KEY must be set to at least 32 characters in production.");
  }
  // Development only: a per-process random key (sessions reset on restart). Shared across HMR reloads.
  const g = globalThis as unknown as Record<symbol, string | undefined>;
  if (!g[globalKey]) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    g[globalKey] = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    console.warn(
      "[session] APP_SESSION_KEY is missing or shorter than 32 characters; using a random per-process key (development only).",
    );
  }
  return g[globalKey]!;
}

export function sessionOptions(): SessionOptions {
  return {
    cookieName: SESSION_COOKIE,
    password: resolvePassword(),
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/**
 * Session read for Server Components (pages). iron-session reads the clock while unsealing the cookie, so the
 * request-time dependency is declared explicitly with connection() before it (otherwise `next dev` reports an
 * unstable `Date.now()` during prerender). Route handlers keep using getSession()/requireSession().
 */
export async function getSessionForPage(): Promise<IronSession<SessionData>> {
  await connection();
  return getSession();
}

/** Thrown by requireSession(); `toResponse()` yields the 401 JSON response. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
  toResponse(): Response {
    return Response.json(
      { error: { code: "unauthorized", message: fa.errors.unauthorizedReconnect } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export function isUnauthorized(error: unknown): error is UnauthorizedError {
  return error instanceof UnauthorizedError;
}

/** Returns the session data or throws UnauthorizedError. Prefer `withSession` in route handlers. */
export async function requireSession(): Promise<ValidSession> {
  const s = await getSession();
  if (!s.token || !s.accountId) throw new UnauthorizedError();
  return { token: s.token, accountId: s.accountId, teamId: s.teamId, userName: s.userName, teamName: s.teamName, teamMemberRole: s.teamMemberRole };
}

/**
 * Route-handler wrapper: `export const GET = withSession(async (req, session) => Response.json(...))`.
 * Converts a missing session into a 401 response.
 */
export function withSession<Args extends unknown[]>(
  handler: (session: ValidSession, request: Request, ...rest: Args) => Promise<Response> | Response,
) {
  return async (request: Request, ...rest: Args): Promise<Response> => {
    try {
      const session = await requireSession();
      return await handler(session, request, ...rest);
    } catch (error) {
      if (isUnauthorized(error)) return error.toResponse();
      throw error;
    }
  };
}

/** Safe projection for the browser. Whitelists fields, so a future field can never leak by accident. */
export function sessionPublicView(
  session: Partial<Pick<SessionData, "accountId" | "teamId" | "userName" | "teamName" | "teamMemberRole">> | null | undefined,
): SessionPublicView | null {
  if (!session?.accountId) return null;
  const view: SessionPublicView = { connected: true, accountId: session.accountId };
  if (session.teamId) view.teamId = session.teamId;
  if (session.userName) view.userName = session.userName;
  if (session.teamId && session.teamName) view.teamName = session.teamName;
  if (session.teamId && session.teamMemberRole) view.teamMemberRole = session.teamMemberRole;
  return view;
}

/**
 * CSRF guard for cookie-authenticated mutations: when an Origin header is present its host must equal the
 * request host (or the forwarded host behind Liara's proxy). Requests without Origin (curl, server-side) pass.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host"), new URL(request.url).host]
    .filter((h): h is string => Boolean(h))
    .flatMap((h) => h.split(",").map((p) => p.trim().toLowerCase()));
  return hosts.includes(originHost.toLowerCase());
}
