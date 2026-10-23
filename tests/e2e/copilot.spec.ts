// Copilot UI against the deterministic MOCK stream (NEXT_PUBLIC_COPILOT_MOCK=1). Proves UI state transitions only,
// never that the real agent or Liara integration works.
import { expect, test, type Page } from "@playwright/test";
import { openService, servicePanel, watchConsole } from "./helpers";

const CHIP_500 = "سایتم خطای ۵۰۰ می‌دهد";
// The verified title is «مشکل برطرف شد ✓»; no other copy may contain «برطرف شد».
const VERIFIED = "مشکل برطرف شد ✓";
const CLAIMS_FIXED = /برطرف شد/;

async function ask(page: Page, scenario: string, chip = CHIP_500) {
  await openService(page, "broken-shop", "copilot", `&scenario=${scenario}`);
  const panel = servicePanel(page);
  await expect(panel.getByText("حالت آزمایشی (داده‌ی ساختگی)")).toBeVisible();
  await panel.getByRole("button", { name: chip }).click();
  return panel;
}

async function openApproval(page: Page, scenario: string) {
  const panel = await ask(page, scenario);
  await panel.getByRole("button", { name: "بررسی و تأیید" }).click();
  const dialog = page.getByRole("dialog", { name: /تأیید: تنظیم متغیر محیطی/ });
  await expect(dialog).toBeVisible();
  return { panel, dialog };
}

test.describe("copilot (mock stream)", () => {
  test("empty state offers suggested chips and a labelled composer", async ({ page }) => {
    await openService(page, "broken-shop", "copilot", "&scenario=s1");
    const panel = servicePanel(page);
    await expect(panel.getByRole("list", { name: "پرسش‌های پیشنهادی" }).getByRole("button")).toHaveCount(4);
    // The textbox is named by its scope («پرسش دربارهٔ broken-shop»); see the a11y spec for the visible-label mismatch.
    await expect(panel.getByRole("textbox", { name: /broken-shop/ })).toBeVisible();
    await expect(panel.getByRole("button", { name: "ارسال" })).toBeVisible();
  });

  test("investigation → finding with evidence level → proposal", async ({ page }) => {
    const watch = watchConsole(page);
    const panel = await ask(page, "s1");

    const timeline = panel.getByRole("list").filter({ hasText: "خواندن وضعیت اپ" });
    await expect(timeline.getByText("خواندن لاگ‌های ۱۵ دقیقهٔ اخیر")).toBeVisible();
    await expect(timeline.getByText("تحلیل شواهد")).toBeVisible();
    // The timeline is a polite live region.
    await expect(panel.locator('[aria-live="polite"]').filter({ hasText: "خواندن وضعیت اپ" })).toHaveCount(1);

    await expect(panel.getByText("نتیجهٔ بررسی")).toBeVisible();
    await expect(panel.getByRole("heading", { name: /^مشاهده‌شده/ })).toBeVisible();
    await expect(panel.getByRole("heading", { name: /^برداشت/ })).toBeVisible();
    await expect(panel.getByRole("heading", { name: /^نامشخص/ })).toBeVisible();
    // Evidence level is a text chip computed by rules, not colour alone.
    await expect(panel.getByText("شواهد قوی", { exact: true })).toBeVisible();
    // Evidence ids are shown in LTR so they do not get bidi-mangled.
    const evidenceId = panel.getByText("O1", { exact: true }).first();
    await expect(evidenceId).toBeVisible();

    await expect(panel.getByText("پیشنهاد همیار")).toBeVisible();
    await expect(panel.getByText("سطح ۱: تأیید ساده")).toBeVisible();
    await expect(panel.getByText("منتظر تأیید شما")).toBeVisible();
    await expect(panel.getByRole("button", { name: "بررسی و تأیید" })).toBeEnabled();
    // Nothing claims success yet.
    await expect(panel.getByText(VERIFIED)).toHaveCount(0);
    watch.stop();
    expect(watch.errors).toEqual([]);
  });

  test("approval dialog: named, masks values, traps focus; a tier-1 action needs no typed name", async ({ page }) => {
    const { dialog } = await openApproval(page, "s1");
    await expect(dialog).toContainText("مقدارها هیچ‌وقت نمایش داده نمی‌شوند.");
    await expect(dialog).toContainText("ساخته‌شده توسط سرور");
    // Tier 1: only one confirm, no type-the-name field. (The mock offers no tier >= 2 proposal; the typed-name
    // gate is exercised on the create wizards in create.spec.ts and by tests/unit/copilot/approval.test.ts.)
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "تأیید و اجرا" })).toBeEnabled();

    // Focus trap: Tab many times, focus never leaves the dialog.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `focus escaped after ${i + 1} Tab presses`).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    // Escape closes it and nothing was executed.
    await page.keyboard.press("Escape");
    // (On narrow screens the service panel is itself a dialog, so look for the approval dialog by name.)
    await expect(page.getByRole("dialog", { name: /تأیید: / })).toHaveCount(0);
  });

  test("approve → execution → verified: «مشکل برطرف شد» only after verification", async ({ page }) => {
    const { panel, dialog } = await openApproval(page, "s1");
    await dialog.getByRole("button", { name: "تأیید و اجرا" }).click();
    // The dialog confirms the request was recorded; success is not claimed there.
    await expect(dialog.getByText("درخواست ثبت شد")).toBeVisible();
    await expect(page.getByText(VERIFIED)).toHaveCount(0);
    await dialog.getByRole("button", { name: "بستن" }).first().click();

    await expect(panel.getByText("اجرای تأییدشده")).toBeVisible();
    await expect(panel.getByText(VERIFIED).first()).toBeVisible({ timeout: 40_000 });
    await expect(panel.getByRole("region", { name: "نتیجهٔ راستی‌آزمایی" })).toBeVisible();
    await expect(panel.getByText("اجرا و تأیید شد")).toBeVisible();
    await expect(panel.getByText("تأیید نشد")).toHaveCount(0);
  });

  test("not_verified scenario: executed but NEVER «برطرف شد»", async ({ page }) => {
    const { panel, dialog } = await openApproval(page, "not_verified");
    await dialog.getByRole("button", { name: "تأیید و اجرا" }).click();
    await dialog.getByRole("button", { name: "بستن" }).first().click();
    await expect(panel.getByText("اجرا شد، اما تأیید نشد").first()).toBeVisible({ timeout: 40_000 });
    await expect(panel.getByText(/^تأیید نشد/).first()).toBeVisible();
    await expect(page.getByText(VERIFIED)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(CLAIMS_FIXED);
  });

  test("rejecting a proposal executes nothing", async ({ page }) => {
    const panel = await ask(page, "s1");
    await panel.getByRole("button", { name: "رد", exact: true }).click();
    await expect(panel.getByText("رد شد").first()).toBeVisible();
    await expect(panel.getByRole("button", { name: "بررسی و تأیید" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(CLAIMS_FIXED);
  });

  test("healthy scenario makes no proposal and claims no fix", async ({ page }) => {
    const panel = await ask(page, "healthy", "وضعیت کلی را بگو");
    await expect(panel.getByText("مشکلی پیدا نشد")).toBeVisible();
    await expect(panel.getByRole("button", { name: "بررسی و تأیید" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(CLAIMS_FIXED);
  });

  test("insufficient data: the copilot says so instead of guessing", async ({ page }) => {
    const panel = await ask(page, "insufficient", "سایتم کند شده");
    await expect(panel.getByText("برای تشخیص، اطلاعات کافی نیست")).toBeVisible();
    await expect(panel.getByRole("button", { name: "بررسی و تأیید" })).toHaveCount(0);
  });

  test("LLM-down degrade keeps rule-based findings and says the AI is unavailable", async ({ page }) => {
    const panel = await ask(page, "llm_down");
    await expect(panel.getByText("هوش مصنوعی در دسترس نیست").first()).toBeVisible();
    await expect(panel.getByText("نتیجهٔ بررسی")).toBeVisible();
  });

  test("log lines that look like instructions are flagged and never executed", async ({ page }) => {
    const panel = await ask(page, "injection");
    await expect(panel.getByText("نتیجهٔ بررسی")).toBeVisible();
    await expect(panel.getByText(/احتمال دستور مخرب در لاگ/).first()).toBeVisible();
    await expect(page.getByRole("dialog", { name: /تأیید: / })).toHaveCount(0);
  });

  test("the fake Liara received no mutation from the mock copilot", async ({ page, request }) => {
    const { resetFakeCalls, fakeCalls } = await import("./helpers");
    await resetFakeCalls(request);
    const { dialog } = await openApproval(page, "s1");
    await dialog.getByRole("button", { name: "تأیید و اجرا" }).click();
    await expect(dialog.getByText("درخواست ثبت شد")).toBeVisible();
    const mutations = (await fakeCalls(request)).filter((c) => c.method !== "GET");
    expect(mutations, "the mock stream must not reach the (fake) Liara").toEqual([]);
  });
});
