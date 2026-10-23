// All inputs are SYNTHETIC (made up for these tests); nothing here was recorded from Liara.
import { describe, expect, it } from "vitest";
import {
  dnsVerdict,
  domainGuidance,
  domainTargetName,
  extractDnsRecords,
  isLikelyApex,
  normalizeDomainInput,
  recordState,
  restrictedTld,
  sslState,
  validateRedirectTarget,
} from "../../../lib/service/app-config/domain-doctor";

describe("recordState (Domain doctor)", () => {
  it("never confirms before a check ran", () => {
    expect(recordState("cname", "demo.liara.run", null)).toBe("not_checked");
    expect(recordState("verification", "code", null)).toBe("not_checked");
    expect(dnsVerdict(null)).toBe("not_checked");
  });

  it("confirms only on an explicit ACTIVE from the check response", () => {
    expect(recordState("cname", "x", { status: "ACTIVE" })).toBe("confirmed");
    expect(recordState("cname", "x", { status: "active" })).toBe("confirmed");
    expect(recordState("cname", "x", { status: "PENDING" })).toBe("pending");
    expect(recordState("cname", "x", { status: "SOMETHING_NEW" })).toBe("pending");
    expect(recordState("cname", "x", {})).toBe("pending");
    expect(dnsVerdict({ status: "PENDING" })).toBe("pending");
    expect(dnsVerdict({ status: "ACTIVE" })).toBe("confirmed");
  });

  it("ties the ACME record to certificatesStatus, not to the DNS status", () => {
    expect(recordState("acme", "x", { status: "ACTIVE", certificatesStatus: "PENDING" })).toBe("pending");
    expect(recordState("acme", "x", { status: "PENDING", certificatesStatus: "ACTIVE" })).toBe("confirmed");
  });

  it("an absent value is 'unavailable' regardless of the check", () => {
    expect(recordState("verification", null, { status: "ACTIVE" })).toBe("unavailable");
    expect(recordState("cname", null, null)).toBe("unavailable");
  });

  it("maps ssl states", () => {
    expect(sslState(undefined)).toBe("none");
    expect(sslState("")).toBe("none");
    expect(sslState("ACTIVE")).toBe("active");
    expect(sslState("PENDING")).toBe("pending");
  });
});

describe("extractDnsRecords", () => {
  it("returns CNameRecord and verificationCode exactly as given, null when absent", () => {
    const r = extractDnsRecords({ CNameRecord: "demo.liara.run", verificationCode: "liara-verify-synthetic" });
    expect(r).toEqual([
      { kind: "cname", value: "demo.liara.run", sourceKey: "CNameRecord" },
      { kind: "verification", value: "liara-verify-synthetic", sourceKey: "verificationCode" },
    ]);
    const empty = extractDnsRecords({ name: "x.ir", CNameRecord: "  " });
    expect(empty.map((x) => x.value)).toEqual([null, null]);
  });

  it("surfaces an ACME record only when the response carries an acme-named string field", () => {
    const r = extractDnsRecords({ CNameRecord: "a", acmeChallengeCname: "_acme.example.liara.run" });
    expect(r.find((x) => x.kind === "acme")).toEqual({ kind: "acme", value: "_acme.example.liara.run", sourceKey: "acmeChallengeCname" });
    expect(extractDnsRecords({ CNameRecord: "a", acmeThing: 5 }).some((x) => x.kind === "acme")).toBe(false);
  });
});

describe("normalizeDomainInput", () => {
  it("normalizes pasted URLs, case and trailing dots", () => {
    expect(normalizeDomainInput("  https://Shop.Example.IR/path?q=1 ")).toEqual({ ok: true, name: "shop.example.ir", unicodeChanged: false });
    expect(normalizeDomainInput("example.com.")).toMatchObject({ ok: true, name: "example.com" });
  });
  it("converts IDN to punycode", () => {
    const r = normalizeDomainInput("سایت.ir");
    expect(r).toMatchObject({ ok: true, unicodeChanged: true });
    expect(r.ok && r.name.startsWith("xn--")).toBe(true);
  });
  it.each([
    ["", "empty"],
    ["localhost", "invalid"],
    ["a b.com", "invalid"],
    ["user@example.com", "invalid"],
    ["example.com:8080", "invalid"],
    ["-bad-.com", "invalid"],
    ["*.example.com", "wildcard"],
    ["site.tk", "restricted_tld"],
    ["site.ML", "restricted_tld"],
  ])("rejects %j as %s", (input, reason) => expect(normalizeDomainInput(input)).toMatchObject({ ok: false, reason }));
});

describe("guidance helpers", () => {
  it("detects .ir, apex, wildcard and restricted TLDs", () => {
    expect(domainGuidance("shop.example.ir")).toEqual({ ir: true, restrictedTld: null, wildcard: false, apex: false });
    expect(domainGuidance("example.ir").apex).toBe(true);
    expect(domainGuidance("example.co.ir").apex).toBe(true);
    expect(domainGuidance("www.example.co.ir").apex).toBe(false);
    expect(domainGuidance("*.example.com").wildcard).toBe(true);
    expect(isLikelyApex("www.example.com")).toBe(false);
    for (const t of ["tk", "ml", "ga", "cf", "gq"]) expect(restrictedTld(`x.${t}`)).toBe(t);
    expect(restrictedTld("x.com")).toBeNull();
  });
  it("maps wildcard names to an audit-safe target name", () => {
    expect(domainTargetName("*.example.com")).toBe("wildcard.example.com");
    expect(domainTargetName("example.com")).toBe("example.com");
  });
});

describe("validateRedirectTarget", () => {
  it("accepts hosts and http(s) URLs", () => {
    expect(validateRedirectTarget("www.example.com", "example.com")).toEqual({ ok: true, value: "www.example.com" });
    expect(validateRedirectTarget("https://example.org/a", "example.com").ok).toBe(true);
  });
  it("rejects itself, credentials, odd schemes and junk", () => {
    for (const bad of ["example.com", "https://u:p@example.org", "javascript://x", "ftp://example.org", "a b.com", "", "nodot", "host.com/path"]) {
      expect(validateRedirectTarget(bad, "example.com").ok).toBe(false);
    }
  });
});
