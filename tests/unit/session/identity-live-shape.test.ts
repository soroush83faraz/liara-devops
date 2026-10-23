// Shape recorded live (GET /v1/me on a real, empty account, read-only spike 2026-10-22; key names in
// tests/fixtures/recorded/spike-2026-10-22.json). The VALUES below are SYNTHETIC: only the key names and JSON types
// are real. The point: Liara's real `user` object carries `_id`, `fullname` AND `email`, and the account id must be
// derived from `_id` (never from the email, which can change) and the display name from `fullname`.
import { describe, expect, it } from "vitest";
import { deriveIdentity, hashAccountId } from "../../../app/api/session/identity";

const liveShapedMe = {
  user: {
    _id: "SYNTH0123456789abcdef0123", // synthetic id; the real one is an opaque string
    fullname: "SYNTHETIC Display Name",
    nationalCode: "0000000000",
    invoiceIssuingEnabled: false,
    email: "synthetic.user@example.invalid",
    phone: "00000000000",
    joined_at: "2020-01-01T00:00:00.000Z",
    freeCreditTime: 0,
    isVerified: true,
    isTeam: false,
    accountType: "REAL_PERSON",
    minCreditAmount: 0,
    isManualMinCredit: false,
    legacyNetworkFeature: false,
    privateNetworkFeature: true,
    hasSucceedPayment: false,
  },
  databaseVersions: { postgres: [{ label: "16", value: "16" }] },
  plans: { projects: {}, databases: {} },
};

describe("deriveIdentity on a body shaped like the recorded /v1/me", () => {
  it("accountId comes from user._id (lower-cased, hashed) and userName from user.fullname", () => {
    const id = deriveIdentity(liveShapedMe);
    expect(id).not.toBeNull();
    expect(id?.accountId).toBe(hashAccountId(liveShapedMe.user._id.toLowerCase()));
    expect(id?.userName).toBe("SYNTHETIC Display Name");
  });

  it("the email does not take part in the id: changing it keeps the account id, changing _id changes it", () => {
    const base = deriveIdentity(liveShapedMe)?.accountId;
    const otherEmail = deriveIdentity({ ...liveShapedMe, user: { ...liveShapedMe.user, email: "changed@example.invalid" } })?.accountId;
    const otherId = deriveIdentity({ ...liveShapedMe, user: { ...liveShapedMe.user, _id: "SYNTHother0123456789abcdef" } })?.accountId;
    expect(otherEmail).toBe(base);
    expect(otherId).not.toBe(base);
  });

  it("nothing else from the body (id, email, phone, national code) leaks into the result", () => {
    const out = JSON.stringify(deriveIdentity(liveShapedMe));
    for (const secret of [liveShapedMe.user._id, liveShapedMe.user.email, liveShapedMe.user.phone, liveShapedMe.user.nationalCode]) expect(out).not.toContain(secret);
  });
});
