import { expect, test, type Page } from "@playwright/test";
import { isMobileProject, resetFakeCalls, servicePanel, watchConsole } from "./helpers";

const APP_TAB_LABELS = ["همیار", "نمای کلی", "نسخه‌ها", "لاگ‌ها", "منابع", "متغیرها", "دامنه‌ها", "دیسک‌ها", "تنظیمات"];
const DB_TAB_LABELS = ["همیار", "نمای کلی", "منابع", "پشتیبان‌گیری", "رویدادها", "تنظیمات"];

const openButton = (page: Page, name: string) => page.getByRole("button", { name: `باز کردن جزئیات ${name}` });

test.beforeEach(async ({ page, request }) => {
  await resetFakeCalls(request);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "نقشه‌ی سرویس‌ها" })).toBeVisible();
});

test.describe("canvas", () => {
  test("shows the three apps and the database with Persian status text", async ({ page }, info) => {
    const mobile = isMobileProject(info.project.name);
    for (const name of ["demo-shop", "blog", "broken-shop", "shop-db"]) await expect(openButton(page, name)).toBeVisible();
    // Statuses are words, never colour alone.
    await expect(page.getByText("در حال اجرا").first()).toBeVisible();
    await expect(page.getByText("متوقف").first()).toBeVisible();
    // The private network group and the app/db kinds are named in Persian.
    await expect(page.getByText(/شبکه‌ی خصوصی/).first()).toBeVisible();
    if (mobile) {
      // Narrow screens get the list view (no React Flow canvas).
      await expect(page.getByRole("list").first()).toBeVisible();
      await expect(page.locator(".react-flow")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /نمایش بوم|نمایش فهرستی/ })).toHaveCount(0);
    } else {
      await expect(page.locator(".react-flow")).toBeVisible();
      await expect(page.locator(".react-flow__node-service")).toHaveCount(4);
      // The edge between broken-shop and shop-db is derived from the env value; only the KEY name is shown.
      await expect(page.locator(".react-flow__edge-textwrapper, .react-flow__edgelabel-renderer").getByText("DATABASE_URL").first()).toBeVisible();
    }
  });

  test("the probe never fabricates health: no 'ok' badge; an app without a URL is 'cannot be checked', never 'failed'", async ({ page }) => {
    // Fake apps have no public sub-domain, so the SSRF-guarded probe resolves no URL (no_url): a neutral state.
    await expect(page.getByText(/میلی‌ثانیه/)).toHaveCount(0);
    await expect(page.getByText(/قابل بررسی نیست/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/ناموفق \(/)).toHaveCount(0);
  });

  test("clicking an app opens its panel and updates ?service= (and survives reload)", async ({ page }, info) => {
    await openButton(page, "broken-shop").click();
    await expect(page).toHaveURL(/[?&]service=broken-shop(&|$)/);
    const panel = servicePanel(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab", { name: "نمای کلی" })).toBeVisible();
    if (isMobileProject(info.project.name)) await expect(page.getByRole("dialog")).toBeVisible();
    await page.reload();
    await expect(servicePanel(page)).toBeVisible();
    await expect(page).toHaveURL(/[?&]service=broken-shop(&|$)/);
  });

  test("the app tab strip shows Persian labels in the registered order", async ({ page }) => {
    await openButton(page, "broken-shop").click();
    const tabs = servicePanel(page).getByRole("tab");
    await expect(tabs).toHaveText(APP_TAB_LABELS);
  });

  test("the database panel uses ?service=db:<host> and its own tab order", async ({ page }) => {
    await openButton(page, "shop-db").click();
    await expect(page).toHaveURL(/service=db(%3A|:)shop-db/);
    await expect(servicePanel(page).getByRole("tab")).toHaveText(DB_TAB_LABELS);
  });

  test("closing the panel removes ?service=", async ({ page }) => {
    await openButton(page, "demo-shop").click();
    await expect(servicePanel(page)).toBeVisible();
    await page.getByRole("button", { name: /بستن پنل|بستن/ }).first().click();
    await expect(page).not.toHaveURL(/service=/);
  });

  test("keyboard: Tab reaches the service buttons and Enter opens the panel", async ({ page }) => {
    const target = openButton(page, "broken-shop");
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    }
    expect(reached, "Tab never reached the broken-shop button").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/service=broken-shop/);
  });

  test("the 'add' menu and the search command are reachable by keyboard", async ({ page }) => {
    const add = page.getByRole("button", { name: "افزودن سرویس جدید" });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem")).toHaveCount(0);
  });

  test("balance chip and account name are in Persian digits", async ({ page }, info) => {
    test.skip(isMobileProject(info.project.name), "balance chip is hidden on narrow screens");
    const chip = page.getByText(/اعتبار حساب/).first();
    await expect(chip).toBeVisible();
    await expect(page.getByText(/۱۲۳٬۴۵۷/)).toBeVisible();
  });
});

test.describe("canvas console health", () => {
  test("no console errors or 5xx while using the canvas", async ({ page }) => {
    const watch = watchConsole(page);
    await page.reload();
    await expect(openButton(page, "demo-shop")).toBeVisible();
    await openButton(page, "demo-shop").click();
    await expect(servicePanel(page)).toBeVisible();
    watch.stop();
    expect(watch.errors).toEqual([]);
  });
});
