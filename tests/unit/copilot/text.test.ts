import { describe, expect, it } from "vitest";
import { faCount, fill, formatCountdown, formatSnapshotValue, truncate } from "@/lib/copilot/text";
import { buildCommandItems, isCommandShortcut } from "@/lib/copilot/command";
import { shouldSubmitOnEnter } from "@/lib/copilot/keys";
import type { OverviewService } from "@/lib/canvas/types";

describe("Persian digit helpers used by the cards", () => {
  it("fills placeholders with Persian digits for numbers and keeps strings", () => {
    expect(fill("{n} ثانیه برای {name}", { n: 30, name: "shop" })).toBe("۳۰ ثانیه برای shop");
    expect(fill("{missing}", {})).toBe("{missing}");
    expect(faCount(1234)).toBe("۱٬۲۳۴");
  });
  it("formats countdowns with Persian digits and never goes negative", () => {
    expect(formatCountdown(9 * 60_000 + 45_000)).toBe("۹:۴۵");
    expect(formatCountdown(5_000)).toBe("۰:۰۵");
    expect(formatCountdown(-1000)).toBe("۰:۰۰");
  });
  it("snapshot cells: numbers Persian, strings LTR, booleans and null labelled", () => {
    expect(formatSnapshotValue(200)).toEqual({ text: "۲۰۰", ltr: false });
    expect(formatSnapshotValue("RUNNING")).toEqual({ text: "RUNNING", ltr: true });
    expect(formatSnapshotValue(true)).toEqual({ text: "بله", ltr: false });
    expect(formatSnapshotValue(null)).toEqual({ text: "—", ltr: false });
    expect(formatSnapshotValue(undefined).text).toBe("—");
  });
  it("truncates by code points", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("ab", 4)).toBe("ab");
  });
});

describe("composer keyboard (IME safe)", () => {
  const e = (o: Partial<Parameters<typeof shouldSubmitOnEnter>[0]>) => ({ key: "Enter", shiftKey: false, ...o });
  it("Enter submits, Shift+Enter does not", () => {
    expect(shouldSubmitOnEnter(e({}))).toBe(true);
    expect(shouldSubmitOnEnter(e({ shiftKey: true }))).toBe(false);
    expect(shouldSubmitOnEnter(e({ key: "a" }))).toBe(false);
  });
  it("Enter that confirms an IME composition never submits (isComposing or keyCode 229)", () => {
    expect(shouldSubmitOnEnter(e({ isComposing: true }))).toBe(false);
    expect(shouldSubmitOnEnter(e({ keyCode: 229 }))).toBe(false);
  });
});

describe("command bar matching", () => {
  const svc = (kind: "app" | "db", name: string): OverviewService =>
    ({ id: kind === "db" ? `db:${name}` : name, kind, name, networkId: null, platformOrEngine: "x", status: "running" }) as OverviewService;
  const services = [svc("app", "shop"), svc("app", "blog"), svc("db", "shop-db")];

  it("empty query lists every service, opening its copilot", () => {
    const items = buildCommandItems(services, "");
    expect(items.map((i) => i.service.name)).toEqual(["blog", "shop", "shop-db"]);
    expect(items.every((i) => i.mode === "open")).toBe(true);
  });
  it("a single word filters services by name, best match first", () => {
    const items = buildCommandItems(services, "shop");
    expect(items.map((i) => i.service.name)).toEqual(["shop", "shop-db"]);
    expect(items[0].mode).toBe("open");
  });
  it("a sentence, or a word matching nothing, becomes a question for every service", () => {
    const sentence = buildCommandItems(services, "why is it slow");
    expect(sentence).toHaveLength(3);
    expect(sentence.every((i) => i.mode === "ask" && i.question === "why is it slow")).toBe(true);
    expect(buildCommandItems(services, "zzz")[0].mode).toBe("ask");
    expect(buildCommandItems([], "x")).toEqual([]);
  });
  it("a question lists the services it names first, flagged related; nothing else is flagged", () => {
    const named = buildCommandItems(services, "why is shop-db slow");
    expect(named.map((i) => i.service.name)).toEqual(["shop-db", "blog", "shop"]);
    expect(named.filter((i) => i.related).map((i) => i.service.name)).toEqual(["shop-db"]);
    expect(buildCommandItems(services, "why is it slow").some((i) => i.related)).toBe(false);
  });
  it("detects Cmd/Ctrl+K only", () => {
    expect(isCommandShortcut({ key: "k", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isCommandShortcut({ key: "K", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isCommandShortcut({ key: "k", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isCommandShortcut({ key: "k", metaKey: true, ctrlKey: false, shiftKey: true })).toBe(false);
  });
});
