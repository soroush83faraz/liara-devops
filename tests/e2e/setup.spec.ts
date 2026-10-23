import { zipSync, strToU8 } from "fflate";
import { expect, test } from "@playwright/test";
import { watchConsole } from "./helpers";

/** A tiny SYNTHETIC Express project: no real code, no secrets. Values in .env are placeholders and must never be read. */
function syntheticZip(): Buffer {
  const files = {
    "demo/package.json": strToU8(JSON.stringify({ name: "synthetic-e2e-app", version: "1.0.0", scripts: { start: "node index.js" }, dependencies: { express: "4.19.2" } })),
    "demo/index.js": strToU8("const app = require('express')();\napp.get('/', (_q, r) => r.send('synthetic'));\napp.listen(process.env.PORT || 3000);\n"),
    "demo/.env.example": strToU8("DATABASE_URL=\nSESSION_SECRET=SYNTH-NOT-A-SECRET\n"),
  };
  return Buffer.from(zipSync(files));
}

test.describe("setup assistant", () => {
  test("renders the page, the start step and both entry modes", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/setup");
    await expect(page.getByRole("heading", { level: 1, name: "دستیار راه‌اندازی" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "بارگذاری فایل پروژه" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "فایل ندارم، توضیح می‌دهم" })).toBeVisible();
    await expect(page.getByLabel("انتخاب فایل").first()).toBeAttached();
    watch.stop();
    expect(watch.errors).toEqual([]);
  });

  test("rejects a file of the wrong type before uploading", async ({ page }) => {
    await page.goto("/setup");
    await page.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByRole("alert").filter({ hasText: "فقط فایل zip یا tar.gz پذیرفته می‌شود." })).toBeVisible();
  });

  test("a tiny synthetic zip is analysed offline with Persian reasons (catalog comes from the fake /v1/me)", async ({ page }) => {
    const responses: string[] = [];
    page.on("response", async (r) => {
      if (r.url().endsWith("/api/setup/analyze")) responses.push(await r.text().catch(() => ""));
    });
    await page.goto("/setup");
    await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-app.zip", mimeType: "application/zip", buffer: syntheticZip() });
    await expect(page.getByText("synthetic-app.zip")).toBeVisible();
    await page.getByRole("button", { name: "بارگذاری و بررسی" }).click();

    // Result step: Persian text, platform detected, port/env hints; nothing from .env values.
    await expect(page.getByText("نتیجه‌ی بررسی").first()).toBeVisible();
    await expect(page.getByText(/Node\.js/).first()).toBeVisible();
    const body = await page.locator("main").innerText();
    expect(body).toMatch(/[؀-ۿ]{3,}/);
    expect(body).not.toContain("SYNTH-NOT-A-SECRET");
    await expect(page.getByText("DATABASE_URL").first()).toBeVisible();

    expect(responses.length).toBeGreaterThan(0);
    const json = JSON.parse(responses[0]) as { analysis?: { platform?: unknown }; recommendation?: unknown; catalogError?: string };
    expect(json.catalogError, "plans catalog should load from the fake Liara").toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("SYNTH-NOT-A-SECRET");
  });

  test("describe mode asks fixed questions instead of guessing", async ({ page }) => {
    await page.goto("/setup");
    await page.getByRole("tab", { name: "فایل ندارم، توضیح می‌دهم" }).click();
    await expect(page.getByText("نوع پروژه را انتخاب کنید.").or(page.getByText("پروژه‌ی شما با چه چیزی ساخته شده؟"))).toBeVisible();
  });
});
