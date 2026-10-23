// Product-health probes: the dev console stays free of Next.js prerender errors and the app serves a favicon.
import { expect, test } from "@playwright/test";

test.describe("product health", () => {
  test("loading the canvas logs no Next.js prerender error to the browser console", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /unstable value `Date\.now\(\)`/.test(m.text())) errors.push(m.text().slice(0, 120));
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500); // the dev overlay message arrives asynchronously after hydration
    expect(errors).toEqual([]);
  });

  test("the app serves a favicon (no 404 on /favicon.ico)", async ({ request }) => {
    const res = await request.get("/favicon.ico");
    expect(res.status()).toBe(200);
  });
});
