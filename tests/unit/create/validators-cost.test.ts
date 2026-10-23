import { describe, expect, it } from "vitest";
import { balanceGate, formatToman, monthlyOf, totalCost } from "@/lib/create/cost";
import { HOURS_PER_MONTH as CONTRACT_HOURS } from "@/lib/contracts/common";
import { HOURS_PER_MONTH, MAX_UPLOAD_BYTES } from "@/lib/create/limits";
import { MAX_SOURCE_SIZE } from "@/lib/liara/deploy";
import {
  archiveKindFromName,
  suggestPort,
  validateAppName,
  validateDbName,
  validateImage,
  validateNetworkName,
  validatePort,
} from "@/lib/create/validators";

describe("name validators", () => {
  it("accepts Liara-style DNS labels", () => {
    for (const ok of ["my-app", "a1", "0day", "shop-2", "a".repeat(63)]) expect(validateAppName(ok)).toBeNull();
    expect(validateDbName("pg-main")).toBeNull();
  });
  it("rejects with a specific code", () => {
    expect(validateAppName("")).toBe("required");
    expect(validateAppName("a")).toBe("tooShort");
    expect(validateAppName("a".repeat(64))).toBe("tooLong");
    expect(validateAppName("My-App")).toBe("charset");
    expect(validateAppName("my_app")).toBe("charset");
    expect(validateAppName("my app")).toBe("charset");
    expect(validateAppName("-app")).toBe("startChar");
    expect(validateAppName("app-")).toBe("edgeHyphen");
    expect(validateAppName("اپ")).toBe("charset");
  });
  it("network names: letters, digits, _ and -, >= 3", () => {
    expect(validateNetworkName("Main_net-1")).toBeNull();
    expect(validateNetworkName("ab")).toBe("tooShort");
    expect(validateNetworkName("_abc")).toBe("startChar");
    expect(validateNetworkName("a b c")).toBe("charset");
    expect(validateNetworkName("")).toBe("required");
  });
  it("image needs a tag or digest", () => {
    expect(validateImage("nginx:1.27")).toBeNull();
    expect(validateImage("registry.example.com:5000/team/app:2.0")).toBeNull();
    expect(validateImage("repo/app@sha256:" + "a".repeat(64))).toBeNull();
    expect(validateImage("nginx")).toBe("imageNeedsTag");
    expect(validateImage("registry.example.com:5000/app")).toBe("imageNeedsTag");
    expect(validateImage("UPPER:1")).toBe("imageInvalid");
    expect(validateImage("a b:1")).toBe("imageInvalid");
    expect(validateImage("")).toBe("required");
  });
  it("port 1-65535", () => {
    expect(validatePort("3000")).toBeNull();
    expect(validatePort("65535")).toBeNull();
    for (const bad of ["0", "65536", "-1", "3000.5", "abc", "1e3"]) expect(validatePort(bad)).toBe("portInvalid");
    expect(validatePort("")).toBe("required");
  });
  it("archive kind by name; port hint", () => {
    expect(archiveKindFromName("a.ZIP")).toBe("zip");
    expect(archiveKindFromName("a.tar.gz")).toBe("targz");
    expect(archiveKindFromName("a.tgz")).toBe("targz");
    expect(archiveKindFromName("a.rar")).toBeNull();
    expect(archiveKindFromName("zip")).toBeNull();
    expect(suggestPort("node")).toBe(3000);
    expect(suggestPort("nope")).toBeUndefined();
  });
});

describe("cost maths and balance gating", () => {
  it("keeps constants in sync with the rest of the repo", () => {
    expect(HOURS_PER_MONTH).toBe(CONTRACT_HOURS);
    expect(MAX_UPLOAD_BYTES).toBe(MAX_SOURCE_SIZE);
  });
  it("monthly = hourly x 720 with 2-decimal rounding", () => {
    expect(monthlyOf(100)).toBe(72000);
    expect(monthlyOf(0.5)).toBe(360);
    expect(monthlyOf(0.333)).toBe(239.76);
  });
  it("totalCost refuses partial sums", () => {
    expect(totalCost([100])).toEqual({ hourly: 100, monthly: 72000 });
    expect(totalCost([0])).toEqual({ hourly: 0, monthly: 0 });
    expect(totalCost([undefined])).toBeNull();
    expect(totalCost([1, undefined])).toBeNull();
    expect(totalCost([-1])).toBeNull();
    expect(totalCost([Number.NaN])).toBeNull();
  });
  it("balanceGate: blocks only when balance is KNOWN and below one hour", () => {
    expect(balanceGate(undefined, 100)).toEqual({ status: "unknown" });
    expect(balanceGate(99, 100)).toEqual({ status: "insufficient", balance: 99, needed: 100 });
    expect(balanceGate(100, 100)).toEqual({ status: "ok", balance: 100 });
    expect(balanceGate(0, 0)).toEqual({ status: "ok", balance: 0 });
    expect(balanceGate(0, undefined)).toEqual({ status: "ok", balance: 0 });
  });
  it("formats Toman with Persian digits and keeps small decimals", () => {
    expect(formatToman(72000)).toMatch(/^[۰-۹٬]+$/);
    expect(formatToman(0.5)).toContain("٫");
    expect(formatToman(0.5)).not.toBe(formatToman(1));
  });
});
