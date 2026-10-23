// Monitoring dashboard («پایش») against the fake Liara: 3 apps + 1 database, `blog` answers 500 on every metrics call.
import { expect, test, type Page } from "@playwright/test";
import { METRICS_DOWN_APP, SECRET_MARKER } from "./fake-liara";
import { isMobileProject, servicePanel, watchConsole } from "./helpers";

const widget = (page: Page, name: string) => page.getByTestId(`obs-widget-${name}`);

async function openDashboard(page: Page) {
  await page.goto("/observability");
  await expect(page.getByRole("heading", { level: 1, name: "پایش" })).toBeVisible();
  await expect(page.getByTestId("obs-widget-grid")).toBeVisible();
}

test.describe("observability dashboard", () => {
  // The dashboard probes running apps like the canvas does; /api/probe has a 60/min budget per account that every spec
  // shares (the canvas probe test depends on it). These tests are about the dashboard, so the probe answer is stubbed
  // with the same "no public URL" result the fake apps produce anyway.
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/probe", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, latencyMs: 0, checkedAt: new Date().toISOString(), error: "no_url" }) }),
    );
  });

  test("is linked from the nav and renders every service; the failing one degrades alone", async ({ page }, info) => {
    const watch = watchConsole(page);
    if (!isMobileProject(info.project.name)) {
      await page.goto("/");
      await page.getByRole("navigation", { name: "ناوبری اصلی" }).getByRole("link", { name: "پایش" }).click();
      await expect(page).toHaveURL(/\/observability$/);
    }
    await openDashboard(page);

    for (const name of ["demo-shop", "broken-shop", "shop-db", METRICS_DOWN_APP]) await expect(widget(page, name)).toBeVisible();

    // The 500 on `blog` shows an explicit unavailable state for blog only.
    await expect(widget(page, METRICS_DOWN_APP).getByTestId("obs-widget-unavailable")).toBeVisible();
    await expect(widget(page, METRICS_DOWN_APP).getByTestId("obs-widget-unavailable")).toContainText("منابع این سرویس در دسترس نیست");
    for (const name of ["demo-shop", "broken-shop", "shop-db"]) {
      await expect(widget(page, name).getByTestId("obs-widget-unavailable")).toHaveCount(0);
      // CPU, RAM and network charts, each with a text alternative that carries min / average / max.
      const charts = widget(page, name).getByRole("img");
      await expect(charts).toHaveCount(3);
      await expect(charts.first()).toHaveAttribute("aria-label", /کمینه.*میانگین.*بیشینه/);
    }

    // Status is icon + text; the summary counts the four services.
    await expect(widget(page, "demo-shop").getByText("در حال اجرا")).toBeVisible();
    await expect(page.getByTestId("obs-summary-total")).toContainText("۴");
    await expect(page.getByTestId("obs-summary-healthy")).toBeVisible();

    // The existing "units unverified" note accompanies the values.
    await expect(page.getByText(/راستی‌آزمایی نشده‌اند/).first()).toBeVisible();

    // Aggregate stacked charts with a named legend per service (blog has no data, so it is not drawn).
    await expect(page.getByTestId("obs-aggregate-chart")).toHaveCount(2);
    const legend = page.getByRole("list", { name: "راهنمای رنگ سرویس‌ها" }).first();
    await expect(legend).toContainText("demo-shop");
    await expect(legend).toContainText("shop-db");
    await expect(legend).not.toContainText(METRICS_DOWN_APP);

    watch.stop();
    expect(watch.errors).toEqual([]);
  });

  test("current value vs plan limit is a labelled meter; deployment markers are dashed vertical lines", async ({ page }) => {
    await openDashboard(page);
    const w = widget(page, "demo-shop");
    await expect(w.getByRole("meter").first()).toHaveAttribute("aria-valuenow", /^\d+$/);
    await expect(w.getByRole("meter").first()).toHaveAccessibleName(/مصرف.*نسبت به سقف پلن/);
    await expect(w.getByText(/از سقف/).first()).toBeVisible();
    // The ~1 h old release lies inside the (2 h) series the fake returns: a dashed line + a visible time label.
    const markers = w.locator(".recharts-reference-line line[stroke-dasharray='4 3']");
    await expect(markers.first()).toBeAttached(); // a zero-width SVG line is never "visible" to Playwright
    await expect(w.locator("svg text").filter({ hasText: /^[۰-۹]{2}:[۰-۹]{2}$/ }).first()).toBeVisible();
    await expect(w.getByText("خط‌چین عمودی: زمان انتشار نسخه")).toBeVisible();
    // Screen-reader list of the same markers.
    await expect(w.getByText(/انتشار نسخه در/).first()).toBeAttached();
  });

  test("the per-service Resources tab shows the same deployment markers", async ({ page }) => {
    await page.goto("/?service=demo-shop&tab=resources");
    await expect(servicePanel(page)).toBeVisible();
    await expect(servicePanel(page).locator(".recharts-reference-line line[stroke-dasharray='4 3']").first()).toBeAttached();
  });

  test("range picker is keyboard operable and drives the API range", async ({ page }) => {
    await openDashboard(page);
    const sixHours = page.getByRole("group", { name: "بازه‌ی زمانی" }).getByRole("button", { name: "۶ ساعت" });
    await expect(page.getByRole("button", { name: "۱ ساعت" })).toHaveAttribute("aria-pressed", "true");
    const request = page.waitForRequest((r) => r.url().includes("/api/observability?") && r.url().includes("range=6h"));
    await sixHours.focus();
    await page.keyboard.press("Enter");
    await request;
    await expect(sixHours).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("obs-widget-grid")).toBeVisible();
  });

  test("hiding a service is remembered per account across reloads", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: /سرویس‌ها.*از.*سرویس/ }).click();
    const box = page.getByRole("checkbox", { name: "نمایش demo-shop" });
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect(widget(page, "demo-shop")).toHaveCount(0);
    await expect(page.getByTestId("obs-summary-total")).toContainText("۳");
    await page.reload();
    await expect(page.getByTestId("obs-widget-grid")).toBeVisible();
    await expect(widget(page, "demo-shop")).toHaveCount(0);
    await page.getByRole("button", { name: /سرویس‌ها.*از.*سرویس/ }).click();
    await page.getByRole("button", { name: "نمایش همه" }).click();
    await expect(widget(page, "demo-shop")).toBeVisible();
  });

  test("auto-refresh shows when it last ran and can be paused", async ({ page }) => {
    await openDashboard(page);
    const status = page.getByTestId("obs-updated");
    await expect(status).toContainText("آخرین به‌روزرسانی");
    await expect(status).toContainText("به‌روزرسانی خودکار هر ۳۰ ثانیه");
    await page.getByRole("button", { name: "توقف به‌روزرسانی خودکار" }).click();
    await expect(status).toContainText("به‌روزرسانی خودکار متوقف است");
    await page.getByRole("button", { name: "ادامه‌ی به‌روزرسانی خودکار" }).click();
    await expect(status).toContainText("هر ۳۰ ثانیه");
  });

  test("a failed refresh keeps the data on screen and says so", async ({ page }) => {
    await openDashboard(page);
    await page.route("**/api/observability?**", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "liara_unavailable", message: "لیارا در حال حاضر در دسترس نیست" } }) }));
    await page.getByRole("button", { name: "به‌روزرسانی", exact: true }).click();
    await expect(page.getByTestId("obs-stale-banner")).toBeVisible();
    await expect(widget(page, "demo-shop")).toBeVisible();
    await page.unroute("**/api/observability?**");
    await page.getByTestId("obs-stale-banner").getByRole("button", { name: "تلاش دوباره" }).click();
    await expect(page.getByTestId("obs-stale-banner")).toHaveCount(0);
  });

  test("recent errors: redacted, inert, LTR, with a deep link to the service's logs tab", async ({ page }) => {
    await openDashboard(page);
    const panel = page.getByTestId("obs-errors-panel");
    const broken = panel.getByTestId("obs-errors-broken-shop");
    await expect(broken).toContainText("ECONNREFUSED");
    expect(await broken.getByRole("listitem").first().evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    // The injection-looking line is plain text, never markup.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    // demo-shop echoed its own SESSION_SECRET value: it is masked before it leaves the server.
    const shop = panel.getByTestId("obs-errors-demo-shop");
    await expect(shop).toContainText("session rejected");
    await expect(page.locator("body")).not.toContainText(SECRET_MARKER);
    await expect(panel.getByTestId("obs-errors-blog")).toContainText("خطایی دیده نشد");

    await broken.getByRole("button", { name: "باز کردن لاگ‌های broken-shop" }).click();
    await expect(page).toHaveURL(/[?&]service=broken-shop&tab=logs/);
    await expect(servicePanel(page)).toBeVisible();
  });

  test("a failed error scan is «نامشخص», never a precise 0 (and partial scans say so)", async ({ page }) => {
    await page.route("**/api/observability/errors?**", async (route) => {
      const real = (await (await route.fetch()).json()) as { entries: Array<{ id: string; name: string }> };
      const entries = real.entries.map((e) => ({ id: e.id, name: e.name, unavailable: true }));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...real, entries }) });
    });
    await openDashboard(page);
    const tile = page.getByTestId("obs-summary-errors");
    await expect(tile.locator("dd").first()).toHaveText("نامشخص"); // the value itself, not a "۰"
    await expect(tile).toContainText("صفر فرض نشده");
    await page.unroute("**/api/observability/errors?**");

    // Real scan: the database is never scanned, so the count is a lower bound with an explicit hint.
    await page.getByRole("button", { name: "به‌روزرسانی", exact: true }).click();
    await expect(tile).toContainText("حداقل");
    await expect(tile).toContainText("اسکن شد");
    await expect(tile).toContainText("برآورد تقریبی");
    await expect(tile).toContainText("۱۰۰۰ خط آخر");
  });

  test("a failed releases lookup says «نامشخص», not «نسخه‌ای ثبت نشده»", async ({ page }) => {
    await page.route("**/api/observability?**", async (route) => {
      const body = (await (await route.fetch()).json()) as { services: Array<Record<string, unknown>> };
      for (const s of body.services) {
        if (s.id === "demo-shop") {
          delete s.lastReleaseAt;
          s.releases = [];
          s.releasesUnavailable = true;
        }
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await openDashboard(page);
    const last = widget(page, "demo-shop").getByTestId("obs-last-release");
    await expect(last).toContainText("نامشخص");
    await expect(last).not.toContainText("نسخه‌ای ثبت نشده");
  });

  test("clicking a service card opens its panel", async ({ page }) => {
    await openDashboard(page);
    await widget(page, "broken-shop").getByRole("button", { name: "باز کردن پنل broken-shop" }).click();
    await expect(page).toHaveURL(/[?&]service=broken-shop(&|$)/);
    await expect(servicePanel(page)).toBeVisible();
  });

  test("API: normalised services, explicit truncation, degraded service, bad params and no secrets", async ({ request }) => {
    const res = await request.get("/api/observability?range=1h");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET_MARKER);
    const body = JSON.parse(text) as {
      unitsVerified: boolean;
      truncated: { shown: number; total: number };
      services: Array<{ id: string; metrics: { unavailable?: boolean; limits?: { ramGb?: number; cpu?: number } }; releases: unknown[] }>;
    };
    expect(body.unitsVerified).toBe(false);
    expect(body.truncated).toEqual({ shown: 4, total: 4 });
    const byId = new Map(body.services.map((s) => [s.id, s]));
    expect(byId.get(METRICS_DOWN_APP)?.metrics.unavailable).toBe(true);
    expect(byId.get("demo-shop")?.metrics.limits).toEqual({ ramGb: 1, cpu: 1 });
    expect(byId.get("demo-shop")?.releases.length).toBe(2);
    expect(byId.get("db:shop-db")?.metrics.unavailable).toBeFalsy();

    expect((await request.get("/api/observability?range=7d")).status()).toBe(400);
    expect((await request.get("/api/observability?network=a%20b")).status()).toBe(400);
    const none = (await (await request.get("/api/observability?network=nope")).json()) as { services: unknown[]; truncated: unknown };
    expect(none.services).toEqual([]);
    expect(none.truncated).toEqual({ shown: 0, total: 0 });
    expect((await request.get("/api/observability/errors?range=bad")).status()).toBe(400);
  });

  test("mobile layout is a single column without horizontal scrolling", async ({ page }, info) => {
    test.skip(!isMobileProject(info.project.name), "390 px layout");
    await openDashboard(page);
    const first = await widget(page, "demo-shop").boundingBox();
    const second = await widget(page, "broken-shop").boundingBox();
    expect(first && second && Math.abs(first.x - second.x) < 2).toBe(true);
    expect(first!.y).not.toBe(second!.y);
    const overflow = await page.locator("#main-content").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
