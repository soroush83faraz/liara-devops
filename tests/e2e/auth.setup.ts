// Runs once before the browser projects: the REAL connect flow through the UI against the fake Liara.
import { expect, test as setup } from "@playwright/test";
import { AUTH_STATE } from "./paths";
import { FAKE_TOKEN } from "./helpers";

setup("connect through the UI", async ({ page }) => {
  await page.goto("/connect");
  await page.getByLabel("کلید API لیارا").fill(FAKE_TOKEN);
  await page.getByRole("button", { name: "اتصال", exact: true }).click();
  await page.waitForURL("**/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.context().storageState({ path: AUTH_STATE });
});
