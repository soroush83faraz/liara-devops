// Team mode through the REAL connect flow against the fake Liara's dual user+team shape (recorded live 2026-10-23,
// see tests/fixtures/recorded/team-billing-2026-10-23.json): the balance chip must show the TEAM balance
// (2,000,000), never the person's 0.6 nor the personal-mode balance, and the account menu names the team.
import { expect, test, type Page } from "@playwright/test";
import { FAKE_TEAM_BILLING_DOWN_ID, FAKE_TEAM_ID, FAKE_TEAM_NAME, FAKE_TEAM_NO_OBJECT_ID } from "./fake-liara";
import { FAKE_TOKEN, fakeCalls, isMobileProject, resetFakeCalls } from "./helpers";

// Fresh browser state: no shared personal session.
test.use({ storageState: { cookies: [], origins: [] } });

async function connect(page: Page, teamId: string) {
  await page.goto("/connect");
  await page.getByLabel("کلید API لیارا").fill(FAKE_TOKEN);
  await page.getByLabel("شناسه‌ی تیم").fill(teamId);
  await page.getByRole("button", { name: "اتصال", exact: true }).click();
  await page.waitForURL("**/");
  await expect(page.getByRole("heading", { level: 1, name: "نقشه‌ی سرویس‌ها" })).toBeVisible();
}

test.describe("team mode balance", () => {
  test.beforeEach(({}, info) => {
    test.skip(isMobileProject(info.project.name), "balance chip is hidden on narrow screens");
  });

  test("the chip shows the team balance (۲٬۰۰۰٬۰۰۰), not the personal one, and the menu names the team", async ({ page }) => {
    await connect(page, FAKE_TEAM_ID);
    const chip = page.locator('span[title="اعتبار تیم"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("۲٬۰۰۰٬۰۰۰");
    await expect(chip).not.toContainText("۰٫۶");
    await expect(page.getByText(/۱۲۳٬۴۵۷/)).toHaveCount(0);

    await page.getByRole("button", { name: "منوی حساب" }).click();
    await expect(page.getByText(FAKE_TEAM_NAME)).toBeVisible();
  });

  test("a team id without a team object in the response: the chip says the balance could not be read, never the personal one", async ({ page }) => {
    await connect(page, FAKE_TEAM_NO_OBJECT_ID);
    const chip = page.locator('span[title="اعتبار این تیم از لیارا خوانده نشد"]');
    await expect(chip).toBeVisible();
    await expect(chip).not.toContainText("۱۲۳٬۴۵۷");
    await expect(chip).not.toContainText("۲٬۰۰۰٬۰۰۰");
  });

  test("team billing answering 403: the chip stays in team mode with the unreadable label, and the wizard blocks a priced create", async ({ page, request }) => {
    await connect(page, FAKE_TEAM_BILLING_DOWN_ID);
    const chip = page.locator('span[title="اعتبار این تیم از لیارا خوانده نشد"]');
    await expect(chip).toBeVisible();
    await expect(page.locator('span[title="اعتبار حساب"]')).toHaveCount(0);
    await expect(chip).not.toContainText("۱۲۳٬۴۵۷");

    await resetFakeCalls(request);
    await page.getByRole("button", { name: "افزودن سرویس جدید" }).click();
    await page.getByRole("menuitem", { name: /^برنامه/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("نام برنامه").fill("new-app");
    await dialog.getByRole("button", { name: "بعدی", exact: true }).click();
    await dialog.getByText("Node.js", { exact: true }).click();
    await dialog.getByRole("button", { name: "بعدی", exact: true }).click();
    await dialog.getByText("iran-g2-small", { exact: true }).click();
    await dialog.getByRole("button", { name: "بعدی", exact: true }).click();
    await dialog.getByRole("button", { name: "بعدی", exact: true }).click();
    await expect(dialog.getByText("بازبینی نهایی")).toBeVisible();
    await expect(dialog.getByText(/اعتبار این تیم از لیارا خوانده نشد؛ تا خوانده شدن/)).toBeVisible();
    await dialog.getByRole("textbox", { name: /نام/ }).last().fill("new-app");
    await dialog.getByRole("switch", { name: /می‌دانم که ساخت این منبع هزینه دارد/ }).click();
    await expect(dialog.getByRole("button", { name: "ساخت برنامه", exact: true })).toBeDisabled();
    expect((await fakeCalls(request)).filter((c) => c.method === "POST")).toEqual([]);
  });
});
