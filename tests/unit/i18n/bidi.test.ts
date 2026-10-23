import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isolateLatin, isolateValue, LRI, PDI } from "../../../lib/i18n/bidi";
import { fa } from "../../../lib/i18n/fa";
import { faPlain, statusCode, stripIsolates } from "../../../lib/i18n/format";
import { t } from "../../../lib/i18n/t";

const iso = (s: string) => `${LRI}${s}${PDI}`;

function leaves(node: unknown, path: string[] = [], out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === "string") out.push([path.join("."), node]);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, [...path, k], out);
  return out;
}

describe("isolateLatin", () => {
  it("isolates fragments that begin or end with punctuation (the «.env» → «env.» bug)", () => {
    expect(isolateLatin("درون‌ریزی از .env")).toBe(`درون‌ریزی از ${iso(".env")}`);
    expect(isolateLatin("مسیر /data را بزنید")).toBe(`مسیر ${iso("/data")} را بزنید`);
    expect(isolateLatin("با https:// بنویسید")).toBe(`با ${iso("https://")} بنویسید`);
    expect(isolateLatin("پیشوند NEXT_PUBLIC_ یا VITE_")).toBe(`پیشوند ${iso("NEXT_PUBLIC_")} یا ${iso("VITE_")}`);
    expect(isolateLatin("مثلاً 5f3a9c…")).toBe(`مثلاً ${iso("5f3a9c")}…`);
    expect(isolateLatin("جایگزین <PASSWORD> شود")).toBe(`جایگزین ${iso("<PASSWORD>")} شود`);
  });

  it("does not eat the sentence's own closing punctuation", () => {
    expect(isolateLatin("فایل .env.")).toBe(`فایل ${iso(".env")}.`);
    expect(isolateLatin("مثال: DATABASE_URL")).toBe("مثال: DATABASE_URL");
  });

  it("isolates every item of a Latin list inside a Persian sentence so the list keeps its order", () => {
    expect(isolateLatin("مثل tk، ml، ga")).toBe(`مثل ${iso("tk")}، ${iso("ml")}، ${iso("ga")}`);
  });

  it("leaves plain words, placeholders, Latin-only strings and already isolated strings alone", () => {
    expect(isolateLatin("کلید API لیارا")).toBe("کلید API لیارا");
    expect(isolateLatin("فایل {file} پیدا شد")).toBe("فایل {file} پیدا شد");
    expect(isolateLatin(".env")).toBe(".env");
    expect(isolateLatin("حذف|پاک|delete")).toBe("حذف|پاک|delete");
    const done = `از ${iso(".env")}`;
    expect(isolateLatin(done)).toBe(done);
    expect(stripIsolates(done)).toBe("از .env");
  });

  it("isolateValue wraps dynamic values whose edges are punctuation", () => {
    expect(isolateValue(".env")).toBe(iso(".env"));
    expect(isolateValue("my-app")).toBe("my-app");
    expect(isolateValue("ساده")).toBe("ساده");
  });
});

describe("the dictionary", () => {
  const entries = leaves(fa);

  it("is isolated everywhere: re-running the isolation changes nothing, and no punctuation-edged Latin run is bare", () => {
    const bare: string[] = [];
    for (const [key, value] of entries) {
      expect(isolateLatin(value), key).toBe(value);
      const withoutIsolated = value.replace(new RegExp(`${LRI}[^${PDI}]*${PDI}`, "g"), "").replace(/\{\w+\}/g, "");
      if (!/[؀-ۿ]/.test(value)) continue;
      for (const m of withoutIsolated.matchAll(/[A-Za-z0-9_.\-:/*=+@#%&?~<>]+/g)) {
        const run = m[0].replace(/[.:,;!?]+$/, "");
        if (/[A-Za-z]/.test(run) && (!/^[A-Za-z]/.test(run) || !/[A-Za-z0-9]$/.test(run))) bare.push(`${key}: ${run}`);
      }
    }
    expect(bare, "Latin runs with edge punctuation that are not bidi-isolated").toEqual([]);
  });

  it("includes every namespace file (nothing bypasses the isolating dictionary)", () => {
    const files = readdirSync(new URL("../../../lib/i18n/ns", import.meta.url)).filter((f) => f.endsWith(".ts"));
    for (const f of files) expect(Object.keys(fa), f).toContain(f.replace(/\.ts$/, ""));
  });

  it("renders the .env import button with an isolated, left-to-right «.env»", () => {
    expect(fa.appConfig.vars.importButton).toBe(`درون‌ریزی از ${iso(".env")}`);
  });
});

describe("numbers in t()", () => {
  it("never groups ports, years and ids", () => {
    expect(faPlain(3000)).toBe("۳۰۰۰");
    expect(faPlain("8080")).toBe("۸۰۸۰");
    expect(faPlain(1404)).toBe("۱۴۰۴");
    expect(t("appConfig.settings.port.current", { port: 3000 })).toBe("پورت فعلی: ۳۰۰۰");
    expect(t("appConfig.settings.port.current", { port: "3000" })).not.toContain("٬");
  });

  it("renders status codes as isolated Latin digits", () => {
    expect(statusCode(500)).toBe(iso("500"));
    expect(t("appConfig.domains.redirect.current", { status: 301 })).toBe(`ریدایرکت ${iso("301")} به`);
    expect(t("appConfig.domains.redirect.current", { status: "2xx" })).toContain(iso("2xx"));
  });

  it("still groups genuine quantities", () => {
    expect(t("errors.rateLimitedCountdown", { seconds: 1200 })).toContain("۱٬۲۰۰");
  });
});

import { fa as faDictionary } from "../../../lib/i18n/fa";
import { describe as describeArrays, expect as expectArrays, it as itArrays } from "vitest";

describeArrays("dictionary isolation keeps arrays as arrays", () => {
  itArrays("array-valued entries (proposal risks, verification steps) stay iterable arrays", () => {
    const risks = (faDictionary as unknown as { setupFlow: { proposal: { risks: unknown } } }).setupFlow.proposal.risks;
    expectArrays(Array.isArray(risks)).toBe(true);
    expectArrays([...(risks as string[])].length).toBeGreaterThan(0);
  });
});
