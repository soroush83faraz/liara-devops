import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ActionTypeSchema, type ActionType } from "../contracts/action";
import type { Store } from "./store";

export { canonicalJson, hashParams, fingerprintState, sha256Hex, CanonicalJsonError } from "./canonical";

/**
 * One-time approval tokens.
 *
 * Format: `v1.<base64url(JSON claims)>.<base64url(HMAC-SHA256(key, "hamyar.approval.v1." + payload))>`.
 * Claims bind proposal, account, target name, action type, params hash, a random
 * 128-bit nonce and an expiry. Verification order: shape -> signature (constant
 * time, before the payload is trusted) -> claims (all compared, no early exit) ->
 * nonce consumption last, so only fully valid tokens burn their nonce.
 *
 * Key: APP_APPROVAL_KEY (>= 32 chars) or, failing that, APP_SESSION_KEY; either is
 * run through HKDF with a purpose-specific label so the approval key never equals
 * the session-cookie key. Neither set: a per-process random key (tokens die on
 * restart and do not work across instances), with a warning.
 */

export const APPROVAL_TOKEN_DEFAULT_TTL_MS = 10 * 60 * 1000;
export const APPROVAL_TOKEN_MAX_TTL_MS = 30 * 60 * 1000;
const MIN_TTL_MS = 1000;
const MAX_TOKEN_LENGTH = 2048;
const VERSION = "v1";
const SIGNING_PREFIX = "hamyar.approval.v1.";
const MIN_KEY_LENGTH = 32;

export type ApprovalTokenFailureReason =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "wrong_account"
  | "wrong_target"
  | "wrong_type"
  | "wrong_params"
  | "wrong_proposal"
  | "replayed";

/**
 * The only error verification throws. Clients see `approval_token_invalid`;
 * `reason` is for server logs only (non-enumerable, excluded from JSON).
 */
export class ApprovalTokenError extends Error {
  readonly code = "approval_token_invalid" as const;
  declare readonly reason: ApprovalTokenFailureReason;
  constructor(reason: ApprovalTokenFailureReason) {
    super("approval token invalid");
    this.name = "ApprovalTokenError";
    Object.defineProperty(this, "reason", { value: reason, enumerable: false, writable: false });
  }
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export class ApprovalKeyConfigError extends Error {
  readonly code = "approval_key_config" as const;
  constructor(message: string) {
    super(message);
    this.name = "ApprovalKeyConfigError";
  }
}

export interface ApprovalClaims {
  proposalId: string;
  accountId: string;
  targetName: string;
  type: ActionType;
  paramsHash: string;
}

export interface MintApprovalTokenInput extends ApprovalClaims {
  ttlMs?: number;
}

export interface MintedApprovalToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

export interface VerifiedApprovalToken extends ApprovalClaims {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export interface TokenKeyOptions {
  /** Explicit key (tests, key rotation). Defaults to the env-derived key. */
  key?: Uint8Array;
  /** Epoch ms; defaults to Date.now(). */
  now?: number;
}

/* ------------------------------------------------------------------ key */

let cachedKey: { approval: string | undefined; session: string | undefined; key: Buffer } | undefined;
let warned = false;
const RANDOM_KEY_SLOT = Symbol.for("hamyar.approval.random-key.v1");

/** One random fallback key per process, shared by every module copy (Next.js bundles routes separately). */
function processRandomKey(): Buffer {
  const g = globalThis as unknown as Record<symbol, Buffer | undefined>;
  let key = g[RANDOM_KEY_SLOT];
  if (!key) {
    key = randomBytes(32);
    g[RANDOM_KEY_SLOT] = key;
  }
  return key;
}

function derive(ikm: string, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(ikm, "utf8"), Buffer.from("hamyar-liara", "utf8"), Buffer.from(label, "utf8"), 32));
}

/** Resolves the HMAC key from the environment (cached until the env values change). */
export function getApprovalKey(): Buffer {
  const approval = process.env.APP_APPROVAL_KEY || undefined;
  const session = process.env.APP_SESSION_KEY || undefined;
  if (cachedKey && cachedKey.approval === approval && cachedKey.session === session) return cachedKey.key;
  let key: Buffer;
  if (approval !== undefined) {
    if (approval.length < MIN_KEY_LENGTH) throw new ApprovalKeyConfigError("APP_APPROVAL_KEY must be at least 32 characters");
    key = derive(approval, "approval-token-key.v1");
  } else if (session !== undefined) {
    if (session.length < MIN_KEY_LENGTH) throw new ApprovalKeyConfigError("APP_SESSION_KEY must be at least 32 characters");
    key = derive(session, "approval-token-key.from-session.v1");
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        "[security] APP_APPROVAL_KEY and APP_SESSION_KEY are unset: using a per-process random approval key; approvals will not survive restarts.",
      );
    }
    key = processRandomKey();
  }
  cachedKey = { approval, session, key };
  return key;
}

/* --------------------------------------------------------------- codec */

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

const ClaimsWireSchema = z.strictObject({
  v: z.literal(1),
  pid: z.string().min(1).max(128),
  acc: z.string().min(1).max(512),
  tgt: z.string().min(1).max(253),
  typ: ActionTypeSchema,
  ph: z.string().regex(/^[a-f0-9]{64}$/),
  n: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

function sign(key: Uint8Array, payload: string): Buffer {
  return createHmac("sha256", key).update(SIGNING_PREFIX).update(payload).digest();
}

function decodeCanonicalB64url(s: string): Buffer | undefined {
  if (!B64URL_RE.test(s)) return undefined;
  const buf = Buffer.from(s, "base64url");
  // Reject non-canonical encodings so a token has exactly one string form.
  return buf.toString("base64url") === s ? buf : undefined;
}

function assertClaimsInput(c: ApprovalClaims) {
  if (
    typeof c.proposalId !== "string" || c.proposalId.length === 0 || c.proposalId.length > 128 ||
    typeof c.accountId !== "string" || c.accountId.length === 0 || c.accountId.length > 512 ||
    typeof c.targetName !== "string" || c.targetName.length === 0 || c.targetName.length > 253 ||
    !ActionTypeSchema.safeParse(c.type).success ||
    typeof c.paramsHash !== "string" || !/^[a-f0-9]{64}$/.test(c.paramsHash)
  ) {
    throw new TypeError("invalid approval claims");
  }
}

/* ---------------------------------------------------------------- API */

export function mintApprovalToken(input: MintApprovalTokenInput, opts: TokenKeyOptions = {}): MintedApprovalToken {
  assertClaimsInput(input);
  const ttl = input.ttlMs ?? APPROVAL_TOKEN_DEFAULT_TTL_MS;
  if (!Number.isInteger(ttl) || ttl < MIN_TTL_MS || ttl > APPROVAL_TOKEN_MAX_TTL_MS) throw new RangeError("ttlMs out of range");
  const now = opts.now ?? Date.now();
  const claims: z.infer<typeof ClaimsWireSchema> = {
    v: 1,
    pid: input.proposalId,
    acc: input.accountId,
    tgt: input.targetName,
    typ: input.type,
    ph: input.paramsHash,
    n: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + ttl,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = sign(opts.key ?? getApprovalKey(), payload).toString("base64url");
  return { token: `${VERSION}.${payload}.${sig}`, expiresAt: claims.exp };
}

/** Signature, shape and claim checks only; does not consume the nonce. Throws ApprovalTokenError. */
export function inspectApprovalToken(token: unknown, expected: ApprovalClaims, opts: TokenKeyOptions = {}): VerifiedApprovalToken {
  if (token === undefined || token === null || token === "") throw new ApprovalTokenError("missing");
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) throw new ApprovalTokenError("malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) throw new ApprovalTokenError("malformed");
  const [, payload, sigText] = parts;
  const payloadBytes = decodeCanonicalB64url(payload);
  const sigBytes = decodeCanonicalB64url(sigText);
  if (!payloadBytes || !sigBytes) throw new ApprovalTokenError("malformed");

  const expectedSig = sign(opts.key ?? getApprovalKey(), payload);
  if (sigBytes.length !== expectedSig.length || !timingSafeEqual(sigBytes, expectedSig)) {
    throw new ApprovalTokenError("bad_signature");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new ApprovalTokenError("malformed");
  }
  const wire = ClaimsWireSchema.safeParse(parsed);
  if (!wire.success) throw new ApprovalTokenError("malformed");
  const c = wire.data;

  // Evaluate every check (no early exit), then report the first failure.
  const now = opts.now ?? Date.now();
  const failures: Array<[boolean, ApprovalTokenFailureReason]> = [
    [!(now < c.exp) || c.exp - c.iat > APPROVAL_TOKEN_MAX_TTL_MS, "expired"],
    [c.acc !== expected.accountId, "wrong_account"],
    [c.pid !== expected.proposalId, "wrong_proposal"],
    [c.tgt !== expected.targetName, "wrong_target"],
    [c.typ !== expected.type, "wrong_type"],
    [c.ph !== expected.paramsHash, "wrong_params"],
  ];
  const failed = failures.find(([bad]) => bad);
  if (failed) throw new ApprovalTokenError(failed[1]);

  return {
    proposalId: c.pid,
    accountId: c.acc,
    targetName: c.tgt,
    type: c.typ,
    paramsHash: c.ph,
    nonce: c.n,
    issuedAt: c.iat,
    expiresAt: c.exp,
  };
}

/**
 * Full verification: inspect, then consume the one-time nonce in the store.
 * A second use of the same token fails with reason `replayed`.
 */
export async function verifyApprovalToken(
  token: unknown,
  expected: ApprovalClaims,
  opts: TokenKeyOptions & { store: Pick<Store, "nonces"> },
): Promise<VerifiedApprovalToken> {
  const verified = inspectApprovalToken(token, expected, opts);
  const now = opts.now ?? Date.now();
  const fresh = await consumeNonce(opts.store, verified.accountId, verified.nonce, verified.expiresAt, now);
  if (!fresh) throw new ApprovalTokenError("replayed");
  return verified;
}

/** Records a nonce as used until `expiresAt`; false when it was used before (or the table is full). */
export function consumeNonce(
  store: Pick<Store, "nonces">,
  accountId: string,
  nonce: string,
  expiresAt: number,
  now: number = Date.now(),
): Promise<boolean> {
  return store.nonces.consume(accountId, nonce, expiresAt, now);
}
