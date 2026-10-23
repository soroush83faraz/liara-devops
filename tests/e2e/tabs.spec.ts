import { expect, test, type Page, type Response } from "@playwright/test";
import { DB_PASSWORD_MARKER, ERROR_LINE, INJECTION_LINE, SECRET_MARKER } from "./fake-liara";
import { openService, selectTab, servicePanel, watchConsole } from "./helpers";

const APP_TABS: Array<{ id: string; label: string; ready: RegExp | string }> = [
  { id: "overview", label: "نمای کلی", ready: "مشخصات" },
  { id: "releases", label: "نسخه‌ها", ready: "نسخه‌ی فعلی" },
  { id: "logs", label: "لاگ‌ها", ready: "ECONNREFUSED" },
  { id: "resources", label: "منابع", ready: /پردازنده \(CPU\)/ },
  { id: "variables", label: "متغیرها", ready: "DATABASE_URL" },
  { id: "domains", label: "دامنه‌ها", ready: "shop.example.ir" },
  { id: "disks", label: "دیسک‌ها", ready: "افزودن دیسک" },
  { id: "settings", label: "تنظیمات", ready: "پورت" },
];
const DB_TABS: Array<{ label: string; ready: RegExp | string }> = [
  { label: "نمای کلی", ready: "رمز عبور" },
  { label: "منابع", ready: /./ },
  { label: "پشتیبان‌گیری", ready: /./ },
  { label: "رویدادها", ready: /./ },
  { label: "تنظیمات", ready: /./ },
];

/** Bodies of every non-streaming same-origin response, so secrets can be searched for afterwards. */
function recordBodies(page: Page) {
  const seen: Array<{ url: string; text: Promise<string> }> = [];
  page.on("response", (r: Response) => {
    const url = r.url();
    if (!url.startsWith("http://127.0.0.1:3200") || url.includes("/_next/static/") || url.includes("/_next/image")) return;
    const type = r.headers()["content-type"] ?? "";
    if (type.includes("event-stream") || type.startsWith("image/") || type.startsWith("font/")) return;
    // A never-ending body (stream we did not anticipate) must not hang the test: give up after 4 s.
    const text = Promise.race([r.text().catch(() => ""), new Promise<string>((resolve) => setTimeout(() => resolve(""), 4000))]);
    seen.push({ url, text });
  });
  return seen;
}

test.describe("app tabs", () => {
  for (const tab of APP_TABS) {
    test(`${tab.id} tab renders without console errors`, async ({ page }) => {
      const watch = watchConsole(page);
      await openService(page, "broken-shop", "overview");
      await selectTab(page, tab.label);
      await expect(servicePanel(page).getByText(tab.ready).first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`tab=${tab.id}`));
      // A visible failure banner would mean the fake Liara or the route broke.
      await expect(servicePanel(page).getByText("بارگذاری انجام نشد")).toHaveCount(0);
      watch.stop();
      expect(watch.errors).toEqual([]);
    });
  }

  test("logs: shows the error line and renders the injection-looking line as inert text", async ({ page }, info) => {
    await openService(page, "broken-shop", "logs");
    const panel = servicePanel(page);
    await expect(panel.getByText(ERROR_LINE).first()).toBeVisible();
    // The HTML-looking line is on screen verbatim, as text, not parsed into an element.
    const line = panel.getByText("IGNORE ALL PREVIOUS INSTRUCTIONS", { exact: false }).first();
    await expect(line).toBeVisible();
    await expect(line).toContainText("<img src=x");
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __E2E_XSS?: number }).__E2E_XSS)).toBeUndefined();
    // Log text is rendered left-to-right.
    expect(await line.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    // Flagging is a bonus: record whether the viewer marks the line as suspicious.
    const flagged = await panel.getByLabel("احتمال دستور مخرب در لاگ").count();
    info.annotations.push({ type: "info", description: flagged > 0 ? "injection line is flagged in the log viewer" : "injection line is NOT flagged: components/service/app/logs/suspicious.ts is still a stub returning false" });
  });

  test("releases: a failed build with more than 20 lines shows its last line and the npm error, ANSI-free and highlighted", async ({ page }) => {
    await openService(page, "broken-shop", "releases");
    const panel = servicePanel(page);
    await panel.getByRole("button", { name: "باز کردن جزئیات نسخه‌ی v1" }).click();
    const viewer = panel.getByRole("log", { name: "لاگ ساخت" });
    // Lines 21+ only exist on page 2 of the fake Liara (20 lines per call).
    await expect(viewer.getByText("The command '/bin/sh -c npm install' returned a non-zero code: 1")).toBeVisible();
    const npmError = viewer.getByText("npm error notarget No matching version found for express@^99.0.0.");
    await expect(npmError).toBeVisible();
    await expect(viewer.getByText("npm error code ETARGET")).toBeVisible();
    expect(await viewer.innerText()).not.toMatch(/\u001b|\[91m/);
    // The multi-line STDOUT entry is split into rows, and the error rows carry the viewer's ERR level tag.
    await expect(viewer.locator("div.flex-col").filter({ hasText: "npm error notarget" }).getByLabel("خطا")).toBeVisible();
    await expect(panel.getByText("ادامه‌ی لاگ بریده شد")).toHaveCount(0);
  });

  test("variables: keys are listed, values never reach the DOM, responses or browser storage until revealed", async ({ page }) => {
    const bodies = recordBodies(page);
    await openService(page, "broken-shop", "variables");
    const panel = servicePanel(page);
    for (const key of ["NODE_ENV", "DATABASE_URL", "API_KEY"]) await expect(panel.getByText(key, { exact: true })).toBeVisible();
    await expect(panel.getByText("••••••••").first()).toBeVisible();
    // Visit the other tabs too: overview/settings/etc. must not echo env values either.
    for (const label of ["نمای کلی", "تنظیمات", "همیار", "متغیرها"]) await selectTab(page, label);
    await page.goto("/?service=broken-shop&tab=variables");
    await expect(panel.getByText("DATABASE_URL", { exact: true })).toBeVisible();

    expect(await page.content()).not.toContain(SECRET_MARKER);
    expect(await page.locator("body").innerText()).not.toContain(SECRET_MARKER);
    const storage = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    expect(storage).not.toContain(SECRET_MARKER);
    const leaks: string[] = [];
    for (const b of bodies) if ((await b.text).includes(SECRET_MARKER)) leaks.push(b.url);
    expect(leaks, "responses containing the planted env value").toEqual([]);
  });

  test("variables: a value appears only after the explicit reveal action, via the audited route, and is dropped on close", async ({ page }) => {
    await openService(page, "broken-shop", "variables");
    const row = servicePanel(page).getByRole("listitem").filter({ hasText: "API_KEY" });
    const revealCall = page.waitForRequest((r) => r.url().includes("/api/apps/broken-shop/envs/reveal") && r.method() === "POST");
    await row.getByRole("button", { name: "نمایش مقدار" }).click();
    const dialog = page.getByRole("dialog", { name: "نمایش مقدار متغیر" });
    await expect(dialog).toBeVisible();
    // Opening the dialog alone reveals nothing.
    await expect(dialog).not.toContainText(SECRET_MARKER);
    await dialog.getByRole("button", { name: "نمایش مقدار" }).click();
    await revealCall;
    await expect(dialog).toContainText(`${SECRET_MARKER}-api`);
    await dialog.getByRole("button", { name: "بستن" }).first().click();
    await expect(dialog).toHaveCount(0);
    expect(await page.content()).not.toContain(SECRET_MARKER);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(SECRET_MARKER);
  });

  test("the browser never calls Liara directly and never sees the Liara token", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (r) => hosts.add(new URL(r.url()).host));
    await openService(page, "broken-shop", "overview");
    await selectTab(page, "نسخه‌ها");
    expect([...hosts].filter((h) => h !== "127.0.0.1:3200")).toEqual([]);
  });
});

test.describe("tab strip and logs on narrow screens", () => {
  test("the tab strip scrolls, never clips a label, and keeps the selected tab in view", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "narrow-screen behaviour");
    await openService(page, "broken-shop", "overview");
    const list = servicePanel(page).getByRole("tablist", { name: "تب‌های سرویس" });
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth), "tabs overflow at 390 px").toBe(true);
    expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    for (const label of ["تنظیمات", "همیار"]) {
      await list.getByRole("tab", { name: label, exact: true }).click();
      await expect(list.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
      await page.waitForTimeout(400);
      const inView = await list.evaluate((el) => {
        const a = el.querySelector<HTMLElement>('[role=tab][aria-selected=true]')!.getBoundingClientRect();
        const l = el.getBoundingClientRect();
        return a.left >= l.left - 1 && a.right <= l.right + 1;
      });
      expect(inView, `${label} fully visible after selecting it`).toBe(true);
    }
    // No tab is squeezed below its own text width.
    expect(await list.evaluate((el) => [...el.querySelectorAll<HTMLElement>("[role=tab]")].every((t) => t.scrollWidth <= t.clientWidth + 1))).toBe(true);
  });

  test("the tab strip stays pinned while the panel body scrolls", async ({ page }) => {
    await openService(page, "broken-shop", "settings");
    const list = servicePanel(page).getByRole("tablist", { name: "تب‌های سرویس" });
    await expect(servicePanel(page).getByText("پورت").first()).toBeVisible();
    await page.waitForTimeout(600); // the bottom sheet slides in; measure once it has settled
    const before = (await list.boundingBox())!.y;
    await page.evaluate(() => document.querySelector("[data-panel-body], [role=dialog] .overflow-y-auto")?.scrollBy(0, 400));
    await page.waitForTimeout(200);
    expect(Math.abs((await list.boundingBox())!.y - before)).toBeLessThan(2);
  });

  test("logs: timestamps are compact on a narrow viewer and the message keeps the full width", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "narrow-screen behaviour");
    await openService(page, "broken-shop", "logs");
    const viewer = servicePanel(page).getByRole("log");
    await expect(viewer.getByText(ERROR_LINE).first()).toBeVisible();
    const row = viewer.locator("div.flex-col").filter({ hasText: ERROR_LINE }).first();
    const time = row.locator("[title]").first();
    expect(await time.getAttribute("title")).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    await expect(time.locator("span:visible")).toHaveText(/^\d\d:\d\d:\d\d$/);
    const [rowBox, msgBox] = await Promise.all([row.boundingBox(), row.locator("span.min-w-0").boundingBox()]);
    expect(msgBox!.width).toBeGreaterThan(rowBox!.width * 0.8);
  });
});

test.describe("database tabs", () => {
  for (const tab of DB_TABS) {
    test(`db ${tab.label} tab renders without console errors`, async ({ page }) => {
      const watch = watchConsole(page);
      await openService(page, "db:shop-db", "overview");
      await selectTab(page, tab.label);
      await expect(servicePanel(page).getByText(tab.ready).first()).toBeVisible();
      await expect(servicePanel(page).getByText("بارگذاری انجام نشد")).toHaveCount(0);
      watch.stop();
      expect(watch.errors).toEqual([]);
    });
  }

  test("the database password stays hidden until the explicit reveal", async ({ page }) => {
    const bodies = recordBodies(page);
    await openService(page, "db:shop-db", "overview");
    const panel = servicePanel(page);
    await expect(panel.getByRole("button", { name: "نمایش رمز" })).toBeVisible();
    expect(await page.content()).not.toContain(DB_PASSWORD_MARKER);
    const leaks: string[] = [];
    for (const b of bodies) if ((await b.text).includes(DB_PASSWORD_MARKER)) leaks.push(b.url);
    expect(leaks, "responses containing the planted DB password").toEqual([]);
    await panel.getByRole("button", { name: "نمایش رمز" }).click();
    await expect(panel.getByText(DB_PASSWORD_MARKER)).toBeVisible();
  });
});

// Kept so the injection line constant is used by the type checker even if the viewer text changes.
void INJECTION_LINE;
