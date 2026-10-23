import { describe, expect, it } from "vitest";
import type { Verification } from "@/lib/contracts";
import { sampleNotVerified, sampleVerification } from "@/lib/contracts/fixtures";
import { fa } from "@/lib/i18n/fa";
import { claimsFixed, failedChecks, snapshotRows, verificationHeadline } from "@/lib/copilot/verification";

describe("verification headline (never 'fixed' unless verified)", () => {
  it("verified only when outcome is verified, there is a check and all pass", () => {
    expect(verificationHeadline(sampleVerification)).toEqual({ kind: "verified" });
    expect(claimsFixed(verificationHeadline(sampleVerification))).toBe(true);
  });
  it("not_verified names the failed check", () => {
    const h = verificationHeadline(sampleNotVerified);
    expect(h).toEqual({ kind: "not_verified", failedCheck: "probe_2xx" });
    expect(claimsFixed(h)).toBe(false);
  });
  it("downgrades a malformed 'verified' payload (failed check or no checks)", () => {
    const failing = { ...sampleVerification, checks: [{ name: "probe_2xx", passed: false, detail: "x" }] } as Verification;
    expect(verificationHeadline(failing)).toEqual({ kind: "not_verified", failedCheck: "probe_2xx" });
    const empty = { checks: [], outcome: "verified" } as Verification;
    expect(claimsFixed(verificationHeadline(empty))).toBe(false);
  });
  it("failed outcome and pending (no result yet) never claim success", () => {
    expect(verificationHeadline({ checks: [], outcome: "failed" })).toEqual({ kind: "failed" });
    expect(verificationHeadline(undefined)).toEqual({ kind: "pending" });
    expect(claimsFixed({ kind: "pending" })).toBe(false);
    expect(claimsFixed({ kind: "failed" })).toBe(false);
  });
  it("the success phrase exists only under verification.verified", () => {
    const phrase = /برطرف شد/; // no negative sentence may contain the substring either
    const hits: string[] = [];
    const walk = (node: unknown, path: string[]) => {
      if (typeof node === "string") {
        if (phrase.test(node)) hits.push(path.join("."));
      } else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
      }
    };
    walk(fa.copilotUi, []);
    // the verified headline, the verified outcome label, and the print footer that explains the rule
    expect(hits.sort()).toEqual(["incidentsPage.outcomeVerified", "incidentsPage.printFooter", "verification.verified"]);
  });
  it("lists failed checks and builds before/after rows from the union of keys", () => {
    expect(failedChecks(sampleNotVerified.checks).map((c) => c.name)).toEqual(["probe_2xx"]);
    const rows = snapshotRows({ a: 1, b: "x" }, { b: "y", c: true });
    expect(rows).toEqual([
      { key: "a", before: 1, after: undefined },
      { key: "b", before: "x", after: "y" },
      { key: "c", before: undefined, after: true },
    ]);
  });
});
