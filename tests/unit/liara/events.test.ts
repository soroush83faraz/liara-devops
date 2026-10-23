import { describe, expect, it } from "vitest";
import { getAppEvents, getAppEventsFeed, parseAppEvents, parseLifecycleEvents } from "@/lib/liara";
import recorded from "../../fixtures/recorded/events-2026-10-23.json";
import oldShape from "../../fixtures/liara/events.synthetic.json";
import { routes } from "./helpers";

describe("lifecycle events parser", () => {
  it("parses the recorded live shape: string unix seconds -> ms, ascending, common fields", () => {
    expect(parseLifecycleEvents(recorded)).toEqual([
      { ts: 1792720495000, action: "create", status: "create", releaseId: "synthetic-release-0001", tag: "v1", containerId: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { ts: 1792720496000, action: "start", status: "start", releaseId: "synthetic-release-0001", tag: "v1", containerId: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  it("parses the other observed live actions (kill, die, stop, destroy) in lifecycle order", () => {
    expect(parseLifecycleEvents(recorded.syntheticStopSequence).map((e) => [e.action, e.ts])).toEqual([
      ["kill", 1792720557000],
      ["die", 1792720558000],
      ["stop", 1792720559000],
      ["destroy", 1792720560000],
    ]);
    expect(parseAppEvents(recorded.syntheticStopSequence).lines.map((l) => l.message.split(" ")[1])).toEqual(["kill", "die", "stop", "destroy"]);
  });

  it("tolerates numbers, milliseconds, ISO text, missing and unknown fields", () => {
    const ev = parseLifecycleEvents({
      data: [
        { action: "DIE", time: 1792720600 },
        { status: "Start", time: "1792720601000", weird: { a: 1 } },
        { action: "stop", time: "2026-10-23T00:00:00Z", release: "" },
        { action: "start" },
        { time: "1792720602" },
        { action: "kill", time: "nope" },
        null,
        "junk",
      ],
    });
    expect(ev.map((e) => [e.action, e.status])).toEqual([["stop", "stop"], ["die", "die"], ["start", "start"]]);
    expect(ev[1].ts).toBe(1792720600000);
    expect(ev[2].ts).toBe(1792720601000);
    expect(ev[0].releaseId).toBeUndefined();
    expect(parseLifecycleEvents({})).toEqual([]);
    expect(parseLifecycleEvents(null)).toEqual([]);
    expect(parseLifecycleEvents("text")).toEqual([]);
  });

  it("orders same-second events like Docker (create, die, start)", () => {
    const ev = parseLifecycleEvents({ data: [{ action: "start", time: "5" }, { action: "die", time: "5" }, { action: "create", time: "5" }] });
    expect(ev.map((e) => e.action)).toEqual(["create", "die", "start"]);
  });
});

describe("app events feed", () => {
  it("renders live lifecycle events as ascending lines and keeps the structured events", () => {
    const feed = parseAppEvents(recorded);
    expect(feed.lifecycle).toHaveLength(2);
    expect(feed.lines.map((l) => l.message)).toEqual([
      "container create release synthetic-release-0001 tag v1",
      "container start release synthetic-release-0001 tag v1",
    ]);
    expect(feed.lines[0].ts).toBe(new Date(1792720495000).toISOString());
  });

  it("falls back to the old Loki-style shape (no lifecycle events), and merges a mixed response", () => {
    const old = parseAppEvents(oldShape);
    expect(old.lifecycle).toEqual([]);
    expect(old.lines[0].message).toContain("OOMKilled");
    const mixed = parseAppEvents({ data: [...oldShape.data, ...recorded.data] });
    expect(mixed.lifecycle).toHaveLength(2);
    expect(mixed.lines).toHaveLength(3);
    const ts = mixed.lines.map((l) => Date.parse(l.ts));
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("getAppEvents / getAppEventsFeed go through the client for the live shape", async () => {
    const { client } = routes({ "GET /v1/projects/demo-shop/events": { json: recorded } });
    expect((await getAppEvents(client, "demo-shop")).map((l) => l.message.split(" ")[1])).toEqual(["create", "start"]);
    expect((await getAppEventsFeed(client, "demo-shop")).lifecycle.map((e) => e.action)).toEqual(["create", "start"]);
  });
});
