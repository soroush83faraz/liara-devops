import { describe, expect, it } from "vitest";
import { ObservationSchema } from "@/lib/contracts/observation";
import { collectAppEvidence } from "@/lib/evidence/collect";
import { extractCrash, extractEvents, extractOom } from "@/lib/evidence/extract";
import { parseLifecycleEvents } from "@/lib/liara";
import recorded from "../../fixtures/recorded/events-2026-10-23.json";
import { ctxOf } from "./helpers";
import { fakeLiara, fakeProbe, loadScenario, nowOf, TEST_TOKEN } from "./helpers";

const T = Date.parse("2026-01-03T10:00:00.000Z");
const sec = (s: number) => String(Math.floor(T / 1000) + s);
const life = (rows: Array<[number, string, string?]>) =>
  parseLifecycleEvents({ data: rows.map(([s, action, release]) => ({ id: "c".repeat(64), status: action, action, time: sec(s), release: release ?? "r3", tag: "v3" })) });
const RELEASE = { id: "r3", tag: "v3", state: "READY", createdAt: "2026-01-03T09:58:00.000Z", finishedAt: "2026-01-03T09:59:30.000Z" };

describe("lifecycle events -> observations", () => {
  it("create/start after a release is an info event related to the release time", () => {
    const ctx = ctxOf({ releases: [RELEASE] });
    ctx.lifecycle = life([[-10, "create"], [-9, "start"]]);
    const [o, ...rest] = extractEvents(ctx);
    expect(rest).toEqual([]);
    expect(o).toMatchObject({ kind: "event", source: "liara:events", severity: "info", summary: "evidence.event.lifecycle" });
    expect(o.params).toMatchObject({ creates: 1, starts: 1, restarts: 0, count: 2, releaseTag: "v3", releaseId: "r3", sinceReleaseSec: 20, sig: 0 });
    expect(o.params.firstSeen).toBe(new Date(T - 10_000).toISOString());
    expect(o.params.lastSeen).toBe(new Date(T - 9_000).toISOString());
    expect(extractCrash(ctx)).toEqual([]);
    expect(extractOom(ctx)).toEqual([]);
  });

  it("die/kill/stop is a warn event; info when another release's container came up afterwards", () => {
    const warn = ctxOf({ releases: [RELEASE] });
    warn.lifecycle = life([[0, "die"], [1, "stop"]]);
    expect(extractEvents(warn).find((o) => o.summary === "evidence.event.container_stop")).toMatchObject({ severity: "warn", summary: "evidence.event.container_stop", params: { count: 2, actions: "die,stop", supersededByOtherRelease: 0 } });
    const swapped = ctxOf({ releases: [RELEASE] });
    swapped.lifecycle = life([[0, "die", "r2"], [2, "create", "r3"]]);
    expect(extractEvents(swapped).find((o) => o.summary === "evidence.event.container_stop")).toMatchObject({ severity: "info", params: { supersededByOtherRelease: 1 } });
  });

  it("die+start x3 within 60 s is a crash loop (error, signature)", () => {
    const ctx = ctxOf({ releases: [RELEASE] });
    ctx.lifecycle = life([[0, "create"], [1, "start"], [10, "die"], [12, "start"], [25, "die"], [27, "start"], [40, "die"], [42, "start"]]);
    const loop = extractCrash(ctx).find((o) => o.summary === "evidence.crash.crashloop");
    expect(loop).toMatchObject({ kind: "crash", source: "liara:events", severity: "error", params: { restarts: 3, windowSec: 60, sig: 1 } });
  });

  it("die+start cycles spread over more than 60 s are not a crash loop", () => {
    const ctx = ctxOf();
    ctx.lifecycle = life([[0, "die"], [1, "start"], [100, "die"], [101, "start"], [200, "die"], [201, "start"]]);
    expect(extractCrash(ctx)).toEqual([]);
  });

  it("an oom action is an OOM observation", () => {
    const ctx = ctxOf();
    ctx.lifecycle = life([[0, "start"], [30, "oom"], [30, "die"]]);
    const [o] = extractOom(ctx);
    expect(o).toMatchObject({ kind: "oom", source: "liara:events", severity: "error", summary: "evidence.oom.container", params: { scope: "container", kills: 1, sig: 1 } });
  });
});

describe("evidence collection with the live events shape", () => {
  it("serves the recorded shape end to end: cited info observation with an id, lifecycle in raw", async () => {
    const s = loadScenario("healthy");
    s.events = {
      data: [
        { id: "a".repeat(64), status: "start", action: "start", time: String(Math.floor(Date.parse("2026-01-03T08:02:00Z") / 1000)), release: "r3", tag: "v3" },
        { id: "a".repeat(64), status: "create", action: "create", time: String(Math.floor(Date.parse("2026-01-03T08:01:50Z") / 1000)), release: "r3", tag: "v3" },
      ],
    };
    const bundle = await collectAppEvidence({ liara: fakeLiara(s).client, name: s.name, probe: fakeProbe(s), now: nowOf(s), knownSecrets: [TEST_TOKEN] });
    expect(bundle.sources.find((x) => x.source === "events")).toMatchObject({ status: "ok", count: 2 });
    const ev = bundle.observations.find((o) => o.summary === "evidence.event.lifecycle");
    expect(ev).toBeDefined();
    expect(ObservationSchema.safeParse(ev).success).toBe(true);
    expect(ev?.id).toMatch(/^O\d+$/);
    expect(ev?.params).toMatchObject({ creates: 1, starts: 1, releaseTag: "v3", sinceReleaseSec: 20 });
    expect((bundle.raw.lifecycle as unknown[]).length).toBe(2);
  });

  it("recorded fixture parses to two events", () => {
    expect(parseLifecycleEvents(recorded)).toHaveLength(2);
  });
});
