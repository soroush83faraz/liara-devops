import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useShellStore } from "@/components/shell/shell-store";
import { useHealthStore } from "@/lib/canvas/health-store";
import { resetAccountClientState } from "@/lib/client/account-reset";
import { useCopilotStore } from "@/lib/copilot/store";
import { useCreateStore } from "@/lib/create/store";

function seedAccountA(qc: QueryClient) {
  qc.setQueryData(["overview"], { services: [{ id: "a-only-service" }] });
  qc.setQueryData(["observability", "acc-A", "metrics", "1h", null], { services: [{ id: "a-only-service" }] });
  qc.setQueryData(["app", "a-only-service", "metrics", "1h"], { range: "1h" });
  useHealthStore.setState({
    byService: { "a-only-service": { status: "down", consecutiveFailures: 3, everHealthy: true } },
    alerts: [{ id: "x#1", serviceId: "a-only-service", raisedAt: "2026-01-01T00:00:00Z", dismissed: false }],
    sessionExpired: true,
  });
  useCopilotStore.setState({ threads: { "app:a-only-service": { turns: [] } as never }, pending: { "app:a-only-service": "why?" } });
  useShellStore.getState().openService("a-only-service", "logs");
  useCreateStore.getState().open({ kind: "network" });
}

describe("resetAccountClientState", () => {
  it("drops account A's cached queries and per-account stores, so account B starts empty", () => {
    const qc = new QueryClient();
    seedAccountA(qc);
    expect(qc.getQueryData(["overview"])).toBeDefined();

    resetAccountClientState(qc);

    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(qc.getQueryData(["overview"])).toBeUndefined();
    expect(qc.getQueryData(["observability", "acc-A", "metrics", "1h", null])).toBeUndefined();
    expect(useHealthStore.getState().byService).toEqual({});
    expect(useHealthStore.getState().alerts).toEqual([]);
    expect(useHealthStore.getState().sessionExpired).toBe(false);
    expect(useCopilotStore.getState().threads).toEqual({});
    expect(useCopilotStore.getState().pending).toEqual({});
    expect(useShellStore.getState().servicePanel.open).toBe(false);
    expect(useCreateStore.getState().dialog).toBeNull();
  });

  it("cancels in-flight queries before clearing", () => {
    const qc = { cancelQueries: vi.fn(() => Promise.resolve()), clear: vi.fn() };
    resetAccountClientState(qc);
    expect(qc.cancelQueries).toHaveBeenCalledTimes(1);
    expect(qc.clear).toHaveBeenCalledTimes(1);
    expect(qc.cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(qc.clear.mock.invocationCallOrder[0]!);
  });

  it("is wired into both disconnect (top bar) and a successful connect (connect form)", () => {
    const root = join(__dirname, "..", "..", "..");
    const bar = readFileSync(join(root, "components/shell/top-bar.tsx"), "utf8");
    const form = readFileSync(join(root, "app/connect/connect-form.tsx"), "utf8");
    expect(bar).toMatch(/resetAccountClientState\(queryClient\);\s*router\.replace/);
    expect(form).toMatch(/resetAccountState\(\);\s*router\.replace/);
  });
});
