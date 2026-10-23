import { describe, expect, it } from "vitest";
import { fa } from "../../../lib/i18n/fa";
import { glossary } from "../../../lib/i18n/glossary.fa";
import { t, type TKey } from "../../../lib/i18n/t";

function collect(node: unknown, path: string[] = [], out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === "string") out.push([path.join("."), node]);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) collect(v, [...path, k], out);
  }
  return out;
}

describe("dictionary", () => {
  const leaves = collect(fa);

  it("has no empty strings", () => {
    expect(leaves.filter(([, v]) => v.trim() === "")).toEqual([]);
  });

  it("populates the namespaces that other units rely on", () => {
    for (const ns of ["common", "connect", "shell", "status", "errors", "approval"] as const) {
      expect(Object.keys(fa[ns]).length).toBeGreaterThan(5);
    }
    for (const ns of ["canvas", "service", "create", "copilot", "incidents", "setup"] as const) {
      expect(Object.keys(fa[ns]).length).toBeGreaterThan(0);
    }
  });

  it("uses glossary terms for shared vocabulary", () => {
    expect(fa.service.tabs.logs).toBe(glossary.logs);
    expect(fa.service.restart).toBe(glossary.restart);
    expect(fa.service.envVars).toBe(glossary["environment variable"]);
    expect(fa.copilot.evidence).toBe(glossary.evidence);
  });

  it("covers every service status", () => {
    for (const s of ["running", "stopped", "building", "failed", "unhealthy", "unknown", "healthy", "degraded"] as const) {
      expect(fa.status[s]).toBeTruthy();
    }
  });

  it("keeps the connect copy required by the product spec", () => {
    expect(fa.connect.headline).toBe("مشکل سایتت رو بگو، بقیه‌اش با ما");
    expect(fa.connect.help.toggle).toBe("کلید API را از کجا بسازم؟");
    expect(fa.connect.safety).toBe("کلید فقط روی سرور ذخیره می‌شود و هرگز به مدل هوش مصنوعی ارسال نمی‌شود.");
    expect(fa.errors.unauthorized).toBe("کلید معتبر نیست یا منقضی شده");
  });

  it("does not use Arabic letter variants (ي ك) that break search and consistency", () => {
    const bad = leaves.filter(([, v]) => /[يك]/.test(v));
    expect(bad).toEqual([]);
  });
});

describe("t()", () => {
  it("resolves nested keys", () => {
    expect(t("common.appName")).toBe("همیار لیارا");
    expect(t("connect.bullets.one")).toBe(fa.connect.bullets.one);
  });

  it("interpolates strings and formats numbers with Persian digits", () => {
    expect(t("canvas.viaVariable", { name: "DATABASE_URL" })).toBe("از طریق متغیر DATABASE_URL");
    expect(t("errors.rateLimitedCountdown", { seconds: 30 })).toBe("تعداد درخواست‌ها زیاد بود. ۳۰ ثانیه‌ی دیگر دوباره تلاش کنید.");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(t("canvas.viaVariable", {})).toBe("از طریق متغیر {name}");
  });

  it("returns the key for a missing path instead of throwing", () => {
    expect(t("nope.missing" as TKey)).toBe("nope.missing");
    expect(t("connect" as TKey)).toBe("connect");
  });
});
