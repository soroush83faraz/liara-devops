// Single network entry point for the copilot UI. In development it can be swapped for the deterministic mock
// (NEXT_PUBLIC_COPILOT_MOCK=1 or ?mock=1). Production builds never include or enable the mock: the NODE_ENV
// guards below are compile-time constants, so the bundler drops the dynamic import entirely.
import type { FetchLike } from "./stream-client";

const MOCK_FLAG_KEY = "hl.copilotMock";

export function isMockEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.NEXT_PUBLIC_COPILOT_MOCK === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("mock") === "1") {
      window.sessionStorage.setItem(MOCK_FLAG_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(MOCK_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Dev-only scenario override from `?scenario=`; undefined means "pick from the question". */
export function mockScenarioFromUrl(): string | undefined {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return undefined;
  try {
    return new URLSearchParams(window.location.search).get("scenario") ?? undefined;
  } catch {
    return undefined;
  }
}

export const copilotFetch: FetchLike = async (input, init) => {
  if (process.env.NODE_ENV !== "production" && isMockEnabled()) {
    const { mockFetch } = await import("./mock-stream");
    return mockFetch(input, init);
  }
  return fetch(input, init);
};

const SCENARIO_KEY = "hl.copilotScenario";

/** Dev-only: remembers the scenario picked in the panel's mock selector (read by the mock server). */
export function setMockScenario(id: string): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    window.sessionStorage.setItem(SCENARIO_KEY, id);
  } catch {
    // storage unavailable: the scenario simply stays automatic
  }
}

export function getMockScenario(): string {
  if (process.env.NODE_ENV === "production") return "auto";
  try {
    return window.sessionStorage.getItem(SCENARIO_KEY) ?? "auto";
  } catch {
    return "auto";
  }
}
