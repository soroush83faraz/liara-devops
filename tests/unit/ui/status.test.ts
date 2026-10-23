import { describe, expect, it } from "vitest";
import { fa } from "../../../lib/i18n/fa";
import { t } from "../../../lib/i18n/t";
import { SERVICE_STATUSES, normalizeStatus, statusMeta } from "../../../components/ui/status";
import { matchesName } from "../../../components/ui/confirm-match";

describe("statusMeta", () => {
  it("gives every status an icon, a Persian label and a tone (never colour alone)", () => {
    for (const s of SERVICE_STATUSES) {
      const m = statusMeta(s);
      expect(m.icon).toBeTruthy();
      expect(t(m.labelKey)).toBe(fa.status[s]);
    }
  });

  it("maps semantic tones", () => {
    expect(statusMeta("healthy").tone).toBe("ok");
    expect(statusMeta("running").tone).toBe("ok");
    expect(statusMeta("degraded").tone).toBe("warn");
    expect(statusMeta("failed").tone).toBe("danger");
    expect(statusMeta("unhealthy").tone).toBe("danger");
    expect(statusMeta("stopped").tone).toBe("neutral");
    expect(statusMeta("unknown").tone).toBe("neutral");
    expect(statusMeta("building").busy).toBe(true);
  });
});

describe("normalizeStatus", () => {
  it("accepts our states in any case", () => {
    expect(normalizeStatus("RUNNING")).toBe("running");
    expect(normalizeStatus(" Failed ")).toBe("failed");
  });
  it("maps common synonyms", () => {
    expect(normalizeStatus("deploying")).toBe("building");
    expect(normalizeStatus("error")).toBe("failed");
    expect(normalizeStatus("down")).toBe("stopped");
  });
  it("never guesses: unrecognised or missing input is unknown", () => {
    expect(normalizeStatus("quantum-superposition")).toBe("unknown");
    expect(normalizeStatus("")).toBe("unknown");
    expect(normalizeStatus(undefined)).toBe("unknown");
    expect(normalizeStatus(null)).toBe("unknown");
  });
});

describe("matchesName (type-to-confirm)", () => {
  it("requires the exact name", () => {
    expect(matchesName("shop-db", "shop-db")).toBe(true);
    expect(matchesName("Shop-db", "shop-db")).toBe(false);
    expect(matchesName("shop-d", "shop-db")).toBe(false);
    expect(matchesName("shop-db-2", "shop-db")).toBe(false);
  });
  it("ignores whitespace added by pasting", () => {
    expect(matchesName("  shop-db\n", "shop-db")).toBe(true);
  });
  it("never matches an empty name", () => {
    expect(matchesName("", "")).toBe(false);
    expect(matchesName("  ", "")).toBe(false);
  });
});

import { rawStatusLabel } from "../../../components/ui/status";
import { emptyAwareDir, isPersian } from "../../../components/ui/dir";

describe("rawStatusLabel", () => {
  it("maps raw Liara states to Persian and leaves unknown ones to the caller", () => {
    expect(rawStatusLabel("ACTIVE")).toBe("در حال اجرا");
    expect(rawStatusLabel("RUNNING")).toBe("در حال اجرا");
    expect(rawStatusLabel("READY")).toBeUndefined();
    expect(rawStatusLabel("weird-state")).toBeUndefined();
    expect(rawStatusLabel(undefined)).toBeUndefined();
  });
});

describe("emptyAwareDir", () => {
  it("is RTL while empty (Persian placeholder) and switches once there is text", () => {
    expect(emptyAwareDir("")).toBe("rtl");
    expect(emptyAwareDir("abc", "ltr")).toBe("ltr");
    expect(emptyAwareDir("سلام")).toBe("auto");
    expect(emptyAwareDir("", "ltr", "postgres://host")).toBe("ltr");
    expect(emptyAwareDir("", "ltr", "مقدار")).toBe("rtl");
    expect(isPersian("مقدار")).toBe(true);
  });
});
