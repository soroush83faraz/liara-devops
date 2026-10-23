// E2E smoke: the real app (next dev, copilot MOCK stream) against a local FAKE Liara. No real network, no LLM.
// Run: `npm run e2e` (or `npx playwright test tests/e2e/canvas.spec.ts --project=desktop`).
import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_PORT, AUTH_STATE, E2E_APPROVAL_KEY, E2E_DATA_DIR as DATA_DIR, E2E_SESSION_KEY, LIARA_PORT } from "./tests/e2e/paths";

// Test-only secrets: random-looking, not used anywhere else.
const TEST_ENV = {
  APP_SESSION_KEY: E2E_SESSION_KEY,
  APP_APPROVAL_KEY: E2E_APPROVAL_KEY,
  LIARA_API_BASE_URL: `http://127.0.0.1:${LIARA_PORT}`,
  NEXT_PUBLIC_COPILOT_MOCK: "1",
  DATA_DIR,
  NEXT_TELEMETRY_DISABLED: "1",
};

// Prefer a system Chrome (no browser download needed); set E2E_CHROMIUM=bundled to use Playwright's own build.
const useSystemChrome = process.env.E2E_CHROMIUM !== "bundled";
const browser = useSystemChrome ? { channel: "chrome" as const } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  outputDir: join(tmpdir(), "hamyar-e2e-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    // Connects once through the real UI against the fake Liara and stores the cookie (the connect route is
    // rate-limited to 10 attempts/minute, so specs reuse this session instead of connecting each time).
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"], ...browser } },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], ...browser, viewport: { width: 1280, height: 800 }, storageState: AUTH_STATE },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      // 390x844 touch viewport; the Chrome engine is used (not WebKit) so one browser install is enough.
      use: { ...devices["Desktop Chrome"], ...browser, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, storageState: AUTH_STATE },
    },
  ],
  webServer: [
    {
      command: "npx tsx tests/e2e/fake-liara.ts",
      url: `http://127.0.0.1:${LIARA_PORT}/__health`,
      env: { FAKE_LIARA_PORT: String(LIARA_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `rm -rf "${DATA_DIR}" && mkdir -p "${DATA_DIR}" && npm run dev -- --port ${APP_PORT} --hostname 127.0.0.1`,
      url: `http://127.0.0.1:${APP_PORT}/connect`,
      env: TEST_ENV,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "ignore",
      // Set E2E_DEBUG=1 to see the dev server's stderr (it logs the known Date.now() prerender error on every load).
      stderr: process.env.E2E_DEBUG ? "pipe" : "ignore",
    },
  ],
});
