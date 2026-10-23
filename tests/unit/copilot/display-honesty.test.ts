// Copilot display honesty: status codes and states in the before/after table, clipboard text, mock timestamps.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IncidentSchema } from "@/lib/contracts";
import { proposalFixtures, sampleIncident } from "@/lib/contracts/fixtures";
import { PROPOSAL_FA } from "@/lib/agent/fa-messages";
import { clipboardText, copyToClipboard } from "@/lib/copilot/clipboard";
import { relocateSampleIncident } from "@/lib/copilot/mock-stream";
import { snapshotCell, stateLabel } from "@/lib/copilot/snapshot-display";
import { LRI, PDI, statusCode } from "@/lib/i18n/bidi";
import { t } from "@/lib/i18n/t";

describe("snapshot cells", () => {
  it("shows HTTP codes as isolated Latin digits, never Persian digits", () => {
    expect(snapshotCell("probeStatus", 200)).toEqual({ kind: "http", code: statusCode("200") });
    expect(snapshotCell("probeStatus", 500)).toEqual({ kind: "http", code: statusCode("500") });
    expect(snapshotCell("http_status", "2xx")).toEqual({ kind: "http", code: statusCode("2xx") });
    // a plain count is still a Persian-digit number
    expect(snapshotCell("errorCount15m", 37)).toEqual({ kind: "number", text: "۳۷" });
  });

  it("maps release/app states to Persian words and keeps the raw enum for the code badge", () => {
    expect(snapshotCell("latestReleaseState", "READY")).toEqual({ kind: "state", raw: "READY", label: "آماده" });
    expect(snapshotCell("appStatus", "RUNNING")).toMatchObject({ kind: "state", raw: "RUNNING", label: "در حال اجرا" });
    expect(stateLabel("FAILED")).toBe("ناموفق");
    // unknown states are shown raw, never guessed
    expect(snapshotCell("appStatus", "WEIRD_STATE")).toEqual({ kind: "state", raw: "WEIRD_STATE", label: undefined });
  });
});

describe("proposal prose", () => {
  it("has no raw READY or Persian-digit «۲xx»; the status code is an isolated Latin run", () => {
    const texts = [...proposalFixtures.proposed.verificationPlan, PROPOSAL_FA.verification.running, PROPOSAL_FA.verification.probes];
    for (const text of texts) {
      expect(text).not.toMatch(/READY/);
      expect(text).not.toContain("۲xx");
    }
    expect(PROPOSAL_FA.verification.probes).toContain(`${LRI}2xx${PDI}`);
  });
});

describe("clipboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("strips bidi isolates from translated text", () => {
    const text = t("setupFlow.review.costLine", { month: 12000 });
    expect(`${LRI}x${PDI}`).not.toBe("x");
    expect(clipboardText(`از ${LRI}.env${PDI} بخوان`)).toBe("از .env بخوان");
    expect(clipboardText(text)).not.toMatch(/[⁦-⁩]/);
  });

  it("writes the stripped text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyToClipboard(`${LRI}broken-shop${PDI} --scale 1`)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("broken-shop --scale 1");
  });

  it("the shared CopyButton goes through copyToClipboard (no private writer that skips the strip)", () => {
    const src = readFileSync("components/ui/copy-button.tsx", "utf8");
    expect(src).toContain("copyToClipboard");
    expect(src).not.toContain("navigator.clipboard");
  });
});

describe("mock incident timestamps", () => {
  it("relocates the sample incident into the past, whatever the viewer's clock says", () => {
    for (const now of [new Date("2026-10-22T06:00:00.000Z"), new Date("2026-10-22T08:41:00.000Z"), new Date("2027-03-01T12:00:00.000Z")]) {
      const moved = relocateSampleIncident(sampleIncident, now);
      expect(IncidentSchema.safeParse(moved).success).toBe(true);
      const stamps = [moved.startedAt, moved.resolvedAt!, ...moved.timeline.map((e) => e.ts), ...moved.finding.facts.flatMap((o) => (o.ts ? [o.ts] : []))];
      for (const s of stamps) expect(Date.parse(s)).toBeLessThanOrEqual(now.getTime());
      expect(Date.parse(moved.resolvedAt!)).toBeLessThan(now.getTime());
      // order is preserved
      expect(Date.parse(moved.startedAt)).toBeLessThan(Date.parse(moved.resolvedAt!));
    }
  });
});

describe("mock data badge stays dev-only", () => {
  it("renders nothing without the mock and its copy is not in the shared dictionary", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { MockDataBadge } = await import("@/components/copilot/mock-data-badge");
    const { devMock } = await import("@/lib/i18n/dev-mock");
    const { fa } = await import("@/lib/i18n/fa");
    expect(renderToString(createElement(MockDataBadge))).toBe("");
    expect(JSON.stringify(fa)).not.toContain(devMock.dataBadge);
    expect(JSON.stringify(fa)).not.toContain("داده‌ی نمونه");
    expect(JSON.stringify(fa)).not.toContain(devMock.mockBadge);
    expect(JSON.stringify(fa)).not.toContain(devMock.scenarioLabel);
  });

  it("only the mock controls and the badge import the dev copy, and both guard on NODE_ENV", async () => {
    const { listFiles, read } = await import("../quality/scan");
    const importers = listFiles(["app", "components", "lib"], [".ts", ".tsx"]).filter((f) => read(f).includes("i18n/dev-mock"));
    expect(importers).toEqual(["components/copilot/mock-controls.tsx", "components/copilot/mock-data-badge.tsx"]);
    for (const f of importers) expect(read(f)).toContain('process.env.NODE_ENV === "production"');
  });
});
