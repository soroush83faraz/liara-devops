import { describe, expect, it } from "vitest";
import { deriveIdentity, hashAccountId } from "../../../app/api/session/identity";
import { isSameOrigin, sessionPublicView } from "../../../lib/session";

const SECRET = "liara-secret-token-AAAAAAAAAAAAAAAA";

describe("sessionPublicView", () => {
  it("never includes the token, even if the object carries extra fields", () => {
    const session = { token: SECRET, accountId: "abc123", teamId: "t1", userName: "سارا", extra: "x" };
    const view = sessionPublicView(session);
    expect(view).toEqual({ connected: true, accountId: "abc123", teamId: "t1", userName: "سارا" });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(view).not.toHaveProperty("token");
    expect(view).not.toHaveProperty("extra");
  });

  it("omits optional fields that are unset", () => {
    expect(sessionPublicView({ accountId: "abc123" })).toEqual({ connected: true, accountId: "abc123" });
  });

  it("returns null for an empty or missing session", () => {
    expect(sessionPublicView({})).toBeNull();
    expect(sessionPublicView(null)).toBeNull();
    expect(sessionPublicView(undefined)).toBeNull();
  });
});

describe("deriveIdentity", () => {
  it("hashes the user id to 16 hex chars", () => {
    const id = deriveIdentity({ user: { _id: "u-1", fullname: "Sara" } });
    expect(id?.accountId).toMatch(/^[0-9a-f]{16}$/);
    expect(id?.accountId).toBe(hashAccountId("u-1"));
    expect(id?.userName).toBe("Sara");
  });
  it("is stable and case-insensitive for emails", () => {
    expect(deriveIdentity({ email: "Sara@Example.com" })?.accountId).toBe(deriveIdentity({ user: { email: "sara@example.com" } })?.accountId);
  });
  it("does not leak the raw id into the account id", () => {
    expect(deriveIdentity({ id: "plain-user-id" })?.accountId).not.toContain("plain");
  });
  it("returns null when nothing identifies the account", () => {
    expect(deriveIdentity({})).toBeNull();
    expect(deriveIdentity(null)).toBeNull();
    expect(deriveIdentity([1, 2])).toBeNull();
    expect(deriveIdentity("str")).toBeNull();
  });
});

describe("isSameOrigin", () => {
  const req = (headers: Record<string, string>) => new Request("http://app.test:3000/api/session", { method: "POST", headers });
  it("allows requests without an Origin header", () => {
    expect(isSameOrigin(req({}))).toBe(true);
  });
  it("allows a matching origin", () => {
    expect(isSameOrigin(req({ origin: "http://app.test:3000", host: "app.test:3000" }))).toBe(true);
  });
  it("allows the forwarded host behind a proxy", () => {
    expect(isSameOrigin(req({ origin: "https://hamyar.liara.run", "x-forwarded-host": "hamyar.liara.run" }))).toBe(true);
  });
  it("rejects a different origin or garbage", () => {
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "app.test:3000" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null" }))).toBe(false);
  });
});
