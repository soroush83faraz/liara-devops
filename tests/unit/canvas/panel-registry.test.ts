import { describe, expect, it } from "vitest";
import { getPanel, listPanelTabs, registerPanel } from "@/lib/canvas/panel-registry";
import { parseServiceId, dbServiceId } from "@/lib/canvas/service-id";

const A = (): null => null;
const B = (): null => null;

describe("panel registry", () => {
  it("registers, looks up, orders and replaces", () => {
    registerPanel("app", "logs", A, { label: "L", order: 2 });
    registerPanel("app", "overview", B, { label: "O", order: 1 });
    registerPanel("db", "overview", B);
    expect(getPanel("app", "logs")).toBe(A);
    expect(getPanel("db", "logs")).toBeUndefined();
    expect(listPanelTabs("app").map((t) => t.tab)).toEqual(["overview", "logs"]);
    expect(listPanelTabs("db")).toEqual([{ tab: "overview", label: "overview" }]);
    registerPanel("app", "logs", B, { label: "L", order: 2 });
    expect(getPanel("app", "logs")).toBe(B);
  });
});

describe("service ids", () => {
  it("round-trips", () => {
    expect(parseServiceId("my-app")).toEqual({ kind: "app", name: "my-app" });
    expect(parseServiceId(dbServiceId("shop-db"))).toEqual({ kind: "db", name: "shop-db" });
  });
});
