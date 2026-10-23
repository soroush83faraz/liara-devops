import { describe, expect, it } from "vitest";
import { groupLines, lineSignature, toEvidenceLine } from "@/lib/evidence/lines";
import { assignIds, draft, MAX_OBSERVATIONS } from "@/lib/evidence/observe";
import { collectChanges, correlate, detectOnset, temporalObservations } from "@/lib/evidence/temporal";
import { ctxOf, iso, T0 } from "./helpers";

const L = (ts: string | undefined, message: string) => toEvidenceLine({ ts, message }, (s) => s);

describe("signatures and dedupe", () => {
  it("normalises numbers, ids and timestamps", () => {
    expect(lineSignature("2026-01-03T10:00:00Z req 9f86d081884c7d65 took 123 ms user=42")).toBe(lineSignature("2026-01-04T11:22:33.456Z req 1b4f0e9851971998 took 7 ms user=9"));
    expect(lineSignature("a3f1c2d4-1111-2222-3333-444455556666 failed")).toBe("<uuid> failed");
    expect(lineSignature("deadbeef happened")).toBe("deadbeef happened");
  });
  it("groups repeated lines with counts, first/last seen and stable order", () => {
    const lines = [L(iso(3), "Error 1 at x"), L(iso(1), "boot"), L(iso(5), "Error 2 at x"), L(iso(2), "Error 3 at x")];
    const g = groupLines(lines);
    expect(g.map((x) => [x.message, x.count])).toEqual([["Error 1 at x", 3], ["boot", 1]]);
    expect(g[0]).toMatchObject({ firstTs: iso(2), lastTs: iso(5), firstIndex: 0 });
  });
  it("lines without timestamps keep no ts (epoch means none)", () => {
    expect(L("1970-01-01T00:00:00.000Z", "x").ts).toBeUndefined();
    expect(L(undefined, "x").ts).toBeUndefined();
  });
});

describe("ids and caps", () => {
  it("assigns O1..On in order and caps per kind and total", () => {
    const many = [...Array(200)].map((_, i) => draft(i % 2 ? "crash" : "connection_error", "liara:logs", "evidence.x", "error", `line ${i}`, {}));
    const obs = assignIds(many);
    expect(obs[0].id).toBe("O1");
    expect(obs.length).toBeLessThanOrEqual(MAX_OBSERVATIONS);
    expect(obs.filter((o) => o.kind === "crash")).toHaveLength(8);
    expect(obs.map((o) => o.id)).toEqual(obs.map((_, i) => `O${i + 1}`));
  });
  it("bounds total text", () => {
    const big = [...Array(60)].map((_, i) => draft(i % 2 ? "event" : "metric", "liara:logs", "evidence.x", "info", "x".repeat(600), {}));
    const total = assignIds(big).reduce((n, o) => n + o.text.length, 0);
    expect(total).toBeLessThanOrEqual(16_000);
  });
});

describe("onset detection", () => {
  it("finds the change point after a quiet period", () => {
    const lines = [L(iso(16), "ok"), ...[...Array(8)].map((_, i) => L(iso(22, i * 20), "Error: boom"))];
    const o = detectOnset(lines, T0, 15);
    expect(o.onsetSource).toBe("change_point");
    expect(o.onsetTs).toBe(iso(22));
    expect(o.firstErrorTs).toBe(iso(22));
    expect(o.atWindowStart).toBe(false);
  });
  it("errors throughout the window -> first error, onset may precede the window", () => {
    const lines = [...Array(15)].map((_, i) => L(iso(15 + i, 10), "Error: boom"));
    const o = detectOnset(lines, T0, 15);
    expect(o.onsetSource).toBe("first_error");
    expect(o.atWindowStart).toBe(true);
  });
  it("no errors -> no onset", () => {
    expect(detectOnset([L(iso(20), "GET / 200 3 ms")], T0, 15).onsetTs).toBeUndefined();
  });
  it("5xx access lines count as errors", () => {
    expect(detectOnset([L(iso(25), "GET /a 502 3 ms")], T0, 15).firstErrorTs).toBe(iso(25));
  });
});

describe("correlation", () => {
  const ctx = ctxOf({
    releases: [{ id: "r3", tag: "v3", state: "READY", createdAt: iso(18), finishedAt: iso(19, 30) }, { id: "r2", tag: "v2", createdAt: iso(-600), finishedAt: iso(-598) }],
    events: [[iso(10), "Environment variables updated"], [iso(26), "Back-off restarting failed container"]],
  });
  const changes = collectChanges(ctx);
  it("collects releases, env changes and restarts chronologically", () => {
    expect(changes.map((c) => c.kind)).toEqual(["release", "env_change", "release", "restart"]);
  });
  it.each([
    [iso(20, 10), true, 40, "v3"],
    [iso(24, 30), true, 300, "v3"],
    [iso(24, 31), false, 301, "v3"],
    [iso(17, 30), true, -120, "v3"], // during the build/deploy interval
  ])("onset %s -> within5min=%s", (onset, within, delta, tag) => {
    const c = correlate(onset, changes)!;
    expect(c).toMatchObject({ within5min: within, deltaSec: delta, withReleaseTag: tag, changeKind: "release" });
  });
  it("env changes count; restarts do not", () => {
    expect(correlate(iso(12), changes)).toMatchObject({ changeKind: "env_change", within5min: true, deltaSec: 120 });
    const onlyRestart = collectChanges(ctxOf({ events: [[iso(20), "Back-off restarting failed container"]] }));
    expect(correlate(iso(21), onlyRestart)).toBeUndefined();
  });
  it("no change before the onset -> undefined", () => {
    expect(correlate(iso(-700), changes)).toBeUndefined();
    expect(correlate(undefined, changes)).toBeUndefined();
  });
  it("emits one temporal observation per correlated change", () => {
    const sig = draft("missing_env", "liara:logs", "evidence.missing_env", "error", "x", { sig: 1 }, iso(20, 10));
    const onset = detectOnset([L(iso(20, 10), "Error: x"), L(iso(20, 20), "Error: x"), L(iso(20, 30), "Error: x")], T0, 15);
    const t = temporalObservations([sig], changes, onset);
    expect(t).toHaveLength(1);
    expect(t[0].params).toMatchObject({ within5min: 1, releaseTag: "v3", changeKind: "release" });
  });
});
