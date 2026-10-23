import { describe, expect, it } from "vitest";
import { buildPanelSearch, parsePanelParams } from "../../../components/shell/panel-params";

describe("parsePanelParams", () => {
  it("reads service and tab", () => {
    expect(parsePanelParams("?service=shop-app&tab=logs")).toEqual({ service: "shop-app", tab: "logs" });
    expect(parsePanelParams(new URLSearchParams("service=db:main"))).toEqual({ service: "db:main" });
  });
  it("ignores a tab without a service and malformed values", () => {
    expect(parsePanelParams("?tab=logs")).toEqual({});
    expect(parsePanelParams("?service=<script>")).toEqual({});
    expect(parsePanelParams("?service=a&tab=../x")).toEqual({ service: "a" });
    expect(parsePanelParams(`?service=${"a".repeat(200)}`)).toEqual({});
  });
});

describe("buildPanelSearch", () => {
  it("sets and clears the panel params while keeping others", () => {
    expect(buildPanelSearch("", { open: true, service: "app1", tab: "logs" })).toBe("?service=app1&tab=logs");
    expect(buildPanelSearch("?view=list", { open: true, service: "app1" })).toBe("?view=list&service=app1");
    expect(buildPanelSearch("?view=list&service=app1&tab=logs", { open: false })).toBe("?view=list");
    expect(buildPanelSearch("?service=app1&tab=logs", { open: false })).toBe("");
  });
  it("replaces an existing service and drops a stale tab", () => {
    expect(buildPanelSearch("?service=a&tab=logs", { open: true, service: "b" })).toBe("?service=b");
  });
});
