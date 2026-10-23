import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashParams } from "../../../lib/security/canonical";
import { createMemoryStore } from "../../../lib/security/store";
import {
  APPROVAL_TOKEN_DEFAULT_TTL_MS,
  ApprovalKeyConfigError,
  ApprovalTokenError,
  getApprovalKey,
  inspectApprovalToken,
  mintApprovalToken,
  verifyApprovalToken,
  type ApprovalClaims,
  type ApprovalTokenFailureReason,
} from "../../../lib/security/tokens";
import { B64URL_ALPHABET, SAMPLE_PARAMS } from "../contracts/samples";

const KEY = Buffer.alloc(32, 1);
const OTHER_KEY = Buffer.alloc(32, 2);
const T0 = 1_760_000_000_000;

const claims: ApprovalClaims = {
  proposalId: "p_abc123",
  accountId: "acct_1",
  targetName: "shop",
  type: "restart",
  paramsHash: hashParams(SAMPLE_PARAMS.restart),
};

const mint = (over: Partial<ApprovalClaims> = {}, now = T0, key = KEY) =>
  mintApprovalToken({ ...claims, ...over }, { key, now }).token;

async function failure(p: Promise<unknown> | (() => unknown)): Promise<ApprovalTokenFailureReason> {
  try {
    if (typeof p === "function") p();
    else await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalTokenError);
    return (e as ApprovalTokenError).reason;
  }
  throw new Error("expected the token to be rejected");
}

const verify = (token: unknown, expected: ApprovalClaims = claims, now = T0 + 1000, store = createMemoryStore(), key = KEY) =>
  verifyApprovalToken(token, expected, { key, now, store });

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
}
function withPayload(token: string, payload: Record<string, unknown>): string {
  const [v, , sig] = token.split(".");
  return `${v}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${sig}`;
}
function signRaw(payloadB64: string, key = KEY): string {
  return `v1.${payloadB64}.${createHmac("sha256", key).update("hamyar.approval.v1.").update(payloadB64).digest("base64url")}`;
}

describe("approval tokens", () => {
  it("round-trips and binds every claim", async () => {
    const { token, expiresAt } = mintApprovalToken(claims, { key: KEY, now: T0 });
    expect(expiresAt).toBe(T0 + APPROVAL_TOKEN_DEFAULT_TTL_MS);
    const v = await verify(token);
    expect(v).toMatchObject({ ...claims, issuedAt: T0, expiresAt });
    expect(v.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("is one-time: a second use is a replay", async () => {
    const store = createMemoryStore();
    const token = mint();
    await verify(token, claims, T0 + 1, store);
    expect(await failure(verify(token, claims, T0 + 2, store))).toBe("replayed");
  });

  it("concurrent double submits: exactly one verification wins", async () => {
    const store = createMemoryStore();
    const token = mint();
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => verify(token, claims, T0 + 5, store)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as ApprovalTokenError).reason).toBe("replayed");
    }
  });

  it("expires exactly at exp", async () => {
    const token = mint();
    await verify(token, claims, T0 + APPROVAL_TOKEN_DEFAULT_TTL_MS - 1);
    expect(await failure(verify(token, claims, T0 + APPROVAL_TOKEN_DEFAULT_TTL_MS))).toBe("expired");
  });

  it("rejects a token signed with another key", async () => {
    expect(await failure(verify(mint({}, T0, OTHER_KEY)))).toBe("bad_signature");
  });

  it("rejects wrong account / target / type / params / proposal without burning the nonce", async () => {
    const store = createMemoryStore();
    const token = mint();
    const cases: Array<[Partial<ApprovalClaims>, ApprovalTokenFailureReason]> = [
      [{ accountId: "acct_2" }, "wrong_account"],
      [{ targetName: "other-shop" }, "wrong_target"],
      [{ type: "delete_app" }, "wrong_type"],
      [{ paramsHash: hashParams(SAMPLE_PARAMS.delete_app) }, "wrong_params"],
      [{ proposalId: "p_other" }, "wrong_proposal"],
    ];
    for (const [over, reason] of cases) {
      expect(await failure(verify(token, { ...claims, ...over }, T0 + 1, store))).toBe(reason);
    }
    await expect(verify(token, claims, T0 + 1, store)).resolves.toMatchObject({ proposalId: claims.proposalId });
  });

  it("rejects every single-character tamper of the token", async () => {
    const token = mint();
    let checked = 0;
    for (let i = 0; i < token.length; i++) {
      const ch = token[i];
      const replacement = ch === "A" ? "B" : ch === "." ? "A" : "A";
      const tampered = token.slice(0, i) + replacement + token.slice(i + 1);
      if (tampered === token) continue;
      const reason = await failure(() => inspectApprovalToken(tampered, claims, { key: KEY, now: T0 + 1 }));
      expect(["malformed", "bad_signature"]).toContain(reason);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("rejects every claim modified under the original signature", async () => {
    const token = mint();
    const payload = decodePayload(token);
    const edits: Record<string, unknown> = {
      pid: "p_evil",
      acc: "acct_evil",
      tgt: "victim",
      typ: "delete_app",
      ph: "b".repeat(64),
      n: "A".repeat(22),
      iat: T0 + 1,
      exp: T0 + 10 * APPROVAL_TOKEN_DEFAULT_TTL_MS,
    };
    for (const [field, value] of Object.entries(edits)) {
      const forged = withPayload(token, { ...payload, [field]: value });
      expect(await failure(() => inspectApprovalToken(forged, claims, { key: KEY, now: T0 + 1 })), field).toBe("bad_signature");
    }
  });

  it("checks the signature before trusting the payload, and the payload shape after", async () => {
    const garbage = Buffer.from("not json", "utf8").toString("base64url");
    expect(await failure(() => inspectApprovalToken(signRaw(garbage, OTHER_KEY), claims, { key: KEY }))).toBe("bad_signature");
    expect(await failure(() => inspectApprovalToken(signRaw(garbage), claims, { key: KEY }))).toBe("malformed");
    const extra = Buffer.from(JSON.stringify({ ...decodePayload(mint()), admin: true }), "utf8").toString("base64url");
    expect(await failure(() => inspectApprovalToken(signRaw(extra), claims, { key: KEY, now: T0 + 1 }))).toBe("malformed");
    const longTtl = Buffer.from(JSON.stringify({ ...decodePayload(mint()), exp: T0 + 24 * 3600_000 }), "utf8").toString("base64url");
    expect(await failure(() => inspectApprovalToken(signRaw(longTtl), claims, { key: KEY, now: T0 + 1 }))).toBe("expired");
  });

  it("rejects missing, non-string and malformed tokens", async () => {
    for (const t of [undefined, null, ""]) expect(await failure(verify(t))).toBe("missing");
    const token = mint();
    const [v, p, s] = token.split(".");
    const malformed: unknown[] = [
      123,
      {},
      [token],
      `${v}.${p}`,
      `${v}.${p}.`,
      `v2.${p}.${s}`,
      `${token}.extra`,
      ` ${token}`,
      `${token}\n`,
      `${v}.${p}=.${s}`,
      `${v}.${p}.${s}A`,
      `${v}.${p}.${s.slice(0, -1)}`,
      "v1..",
      "v1." + "A".repeat(3000) + ".x",
      `${v}.${p}.${s.replace(/[A-Za-z0-9]$/, (c) => (c === "B" ? "C" : "B"))}`,
    ];
    for (const t of malformed) {
      const reason = await failure(verify(t));
      expect(["malformed", "bad_signature"], JSON.stringify(t).slice(0, 40)).toContain(reason);
    }
  });

  it("collapses every failure into one external error", async () => {
    const errors: ApprovalTokenError[] = [];
    for (const t of [undefined, "junk", mint({}, T0, OTHER_KEY)]) {
      try {
        await verify(t);
      } catch (e) {
        errors.push(e as ApprovalTokenError);
      }
    }
    expect(new Set(errors.map((e) => e.message)).size).toBe(1);
    expect(new Set(errors.map((e) => e.reason)).size).toBe(3);
    for (const e of errors) {
      expect(e.code).toBe("approval_token_invalid");
      expect(JSON.stringify(e)).not.toMatch(/reason|missing|malformed|signature/);
      expect(Object.keys(e)).not.toContain("reason");
    }
  });

  it("validates mint inputs", () => {
    for (const ttlMs of [0, -1, 999, 31 * 60_000, Number.NaN, 1.5]) {
      expect(() => mintApprovalToken({ ...claims, ttlMs }, { key: KEY })).toThrow(RangeError);
    }
    expect(() => mintApprovalToken({ ...claims, paramsHash: "nothex" }, { key: KEY })).toThrow(TypeError);
    expect(() => mintApprovalToken({ ...claims, type: "shell" as never }, { key: KEY })).toThrow(TypeError);
    expect(() => mintApprovalToken({ ...claims, accountId: "" }, { key: KEY })).toThrow(TypeError);
  });

  it("uses fresh nonces", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => decodePayload(mint()).n));
    expect(nonces.size).toBe(200);
    for (const n of nonces) expect([...String(n)].every((c) => B64URL_ALPHABET.includes(c))).toBe(true);
  });
});

describe("approval key", () => {
  const saved = { a: process.env.APP_APPROVAL_KEY, s: process.env.APP_SESSION_KEY };
  afterEach(() => {
    if (saved.a === undefined) delete process.env.APP_APPROVAL_KEY;
    else process.env.APP_APPROVAL_KEY = saved.a;
    if (saved.s === undefined) delete process.env.APP_SESSION_KEY;
    else process.env.APP_SESSION_KEY = saved.s;
    vi.restoreAllMocks();
  });

  const secretA = "x".repeat(40);

  it("derives a stable, purpose-separated key from the environment", async () => {
    delete process.env.APP_SESSION_KEY;
    process.env.APP_APPROVAL_KEY = secretA;
    const k1 = getApprovalKey();
    expect(getApprovalKey().equals(k1)).toBe(true);
    expect(k1.equals(Buffer.from(secretA))).toBe(false);

    delete process.env.APP_APPROVAL_KEY;
    process.env.APP_SESSION_KEY = secretA;
    const k2 = getApprovalKey();
    expect(k2.equals(k1)).toBe(false); // same secret, different purpose label
    expect(k2.length).toBe(32);

    const token = mintApprovalToken(claims, { now: T0 }).token;
    process.env.APP_SESSION_KEY = "y".repeat(40);
    expect(await failure(() => inspectApprovalToken(token, claims, { now: T0 + 1 }))).toBe("bad_signature");
  });

  it("rejects short keys instead of silently weakening them", () => {
    process.env.APP_APPROVAL_KEY = "short";
    expect(() => getApprovalKey()).toThrow(ApprovalKeyConfigError);
    delete process.env.APP_APPROVAL_KEY;
    process.env.APP_SESSION_KEY = "short";
    expect(() => getApprovalKey()).toThrow(ApprovalKeyConfigError);
  });

  it("falls back to a random per-process key", () => {
    delete process.env.APP_APPROVAL_KEY;
    delete process.env.APP_SESSION_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const k = getApprovalKey();
    expect(k.length).toBe(32);
    expect(getApprovalKey().equals(k)).toBe(true);
  });
});
