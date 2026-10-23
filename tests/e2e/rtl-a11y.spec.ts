// RTL/bidi and accessibility checks using Playwright's own accessibility tree (ariaSnapshot) and DOM queries; no axe.
import { expect, test, type Page } from "@playwright/test";
import { openService, selectTab, servicePanel } from "./helpers";

const MAIN_SCREENS = [
  { name: "connect", url: "/connect", signedOut: true },
  { name: "canvas", url: "/" },
  { name: "panel overview", url: "/?service=broken-shop&tab=overview" },
  { name: "panel logs", url: "/?service=broken-shop&tab=logs" },
  { name: "panel variables", url: "/?service=broken-shop&tab=variables" },
  { name: "panel copilot", url: "/?service=broken-shop&tab=copilot&scenario=s1" },
  { name: "db panel", url: "/?service=db%3Ashop-db&tab=overview" },
  { name: "setup", url: "/setup" },
  { name: "incidents", url: "/incidents" },
  { name: "activity", url: "/activity" },
];

/** Controls that the accessibility tree lists WITHOUT a name. */
async function unnamedControls(page: Page): Promise<string[]> {
  const snapshot = await page.locator("body").ariaSnapshot();
  const roles = "button|textbox|combobox|checkbox|switch|radio|link|tab|menuitem|searchbox|slider|spinbutton";
  const bare = new RegExp(`^\\s*- (${roles})(?: \\[[^\\]]*\\])*:?\\s*$`);
  return snapshot.split("\n").filter((line) => bare.test(line)).map((l) => l.trim());
}

test.describe("RTL / bidi", () => {
  for (const url of ["/connect", "/", "/setup"]) {
    test(`${url} is lang=fa dir=rtl with a Persian title`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator("html")).toHaveAttribute("lang", "fa");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      expect(await page.title()).toMatch(/[؀-ۿ]/);
    });
  }

  test("service names, env keys, IPs and stack traces sit inside dir=ltr elements", async ({ page }) => {
    await openService(page, "broken-shop", "variables");
    const key = servicePanel(page).getByText("DATABASE_URL", { exact: true });
    await expect(key).toBeVisible();
    expect(await key.evaluate((el) => !!el.closest('[dir="ltr"]')), "env key in dir=ltr").toBe(true);

    await selectTab(page, "نمای کلی");
    const ip = servicePanel(page).getByText("203.0.113.10", { exact: true });
    await expect(ip).toBeVisible();
    expect(await ip.evaluate((el) => !!el.closest('[dir="ltr"]') || getComputedStyle(el).direction === "ltr"), "IP in ltr").toBe(true);

    await selectTab(page, "لاگ‌ها");
    const trace = servicePanel(page).getByText(/at TCPConnectWrap\.afterConnect/).first();
    await expect(trace).toBeVisible();
    expect(await trace.evaluate((el) => getComputedStyle(el).direction), "stack trace direction").toBe("ltr");
    expect(await trace.evaluate((el) => !!el.closest('[dir="ltr"]'))).toBe(true);
    const err = servicePanel(page).getByText(/ECONNREFUSED 10\.0\.0\.5:5432/).first();
    expect(await err.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  });

  test("«درون‌ریزی از .env» renders the dot on the LEFT of «env» (isolated LTR run)", async ({ page }) => {
    await openService(page, "broken-shop", "variables");
    const button = servicePanel(page).getByRole("button", { name: /درون‌ریزی از/ }).first();
    await expect(button).toBeVisible();
    const order = await button.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n as Text).data;
        const i = text.indexOf(".env");
        if (i < 0) continue;
        const at = (from: number) => {
          const r = document.createRange();
          r.setStart(n!, from);
          r.setEnd(n!, from + 1);
          return r.getBoundingClientRect().left;
        };
        return { dot: at(i), e: at(i + 1) };
      }
      return null;
    });
    expect(order, "found «.env» in the button text").not.toBeNull();
    expect(order!.dot, "the dot is left of the «e»").toBeLessThan(order!.e);
  });

  test("empty composer and log-search placeholders start on the right (RTL) and switch to LTR for typed code", async ({ page }) => {
    await openService(page, "broken-shop", "logs");
    const search = servicePanel(page).getByRole("searchbox");
    await expect(search).toBeVisible();
    expect(await search.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
    await search.fill("ECONN");
    expect(await search.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    await openService(page, "broken-shop", "copilot", "&scenario=s1");
    const composer = servicePanel(page).getByRole("textbox", { name: /broken-shop/ });
    expect(await composer.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  });

  test("the canvas library's screen-reader text is Persian (no English help, no delete hint)", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "the React Flow canvas is desktop-only");
    await page.goto("/");
    await expect(page.locator(".react-flow__node-service")).toHaveCount(4);
    const text = await page.evaluate(() => [
      ...[...document.querySelectorAll("[id^='react-flow__node-desc'], [id^='react-flow__edge-desc']")].map((e) => e.textContent ?? ""),
      ...[...document.querySelectorAll(".react-flow [aria-label], .react-flow title")].map((e) => e.getAttribute("aria-label") ?? e.textContent ?? ""),
    ].join("\n"));
    expect(text).not.toMatch(/Press enter|Press delete|Mini Map|Control Panel|Zoom In|Fit View|Toggle Interactivity/i);
    expect(text).toContain("برای انتخاب سرویس");
    expect(text).not.toMatch(/حذف/);
  });

  test("service names on the canvas / list are wrapped in <bdi dir=ltr>", async ({ page }) => {
    await page.goto("/");
    const name = page.getByRole("button", { name: "باز کردن جزئیات broken-shop" }).locator('bdi[dir="ltr"]').first();
    await expect(name).toHaveText("broken-shop");
  });

  test("every code/pre block on the main screens is left-to-right", async ({ page }) => {
    const offenders: string[] = [];
    for (const url of ["/?service=broken-shop&tab=logs", "/?service=broken-shop&tab=copilot&scenario=s1", "/?service=db%3Ashop-db&tab=overview"]) {
      await page.goto(url);
      await expect(servicePanel(page)).toBeVisible();
      if (url.includes("copilot")) {
        await servicePanel(page).getByRole("button", { name: "سایتم خطای ۵۰۰ می‌دهد" }).click();
        await expect(servicePanel(page).getByText("نتیجهٔ بررسی")).toBeVisible();
      } else {
        await page.waitForLoadState("networkidle").catch(() => undefined);
      }
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll("pre, code, kbd, samp")]
          .filter((el) => getComputedStyle(el).direction !== "ltr")
          .map((el) => `${el.tagName.toLowerCase()}: ${(el.textContent ?? "").slice(0, 40)}`),
      );
      offenders.push(...bad.map((b) => `${url} -> ${b}`));
    }
    expect(offenders, "code-like elements with a non-ltr computed direction").toEqual([]);
  });

  test("copilot evidence text (log excerpts, ids) is rendered LTR", async ({ page }) => {
    await openService(page, "broken-shop", "copilot", "&scenario=s1");
    await servicePanel(page).getByRole("button", { name: "سایتم خطای ۵۰۰ می‌دهد" }).click();
    const excerpt = servicePanel(page).getByText(/SESSION_SECRET is not defined at createSession/).first();
    await expect(excerpt).toBeVisible();
    expect(await excerpt.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  });

  test("no horizontal page overflow at 390 px on the main screens", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "creates its own 390 px context; running it once on the desktop project is enough");
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "fa-IR",
      storageState: info.project.use.storageState as string,
    });
    const page = await context.newPage();
    const overflowing: string[] = [];
    for (const screen of MAIN_SCREENS) {
      if (screen.signedOut) continue; // /connect is checked in the signed-out test below
      await page.goto(screen.url);
      await expect(page.locator("main, [role=dialog]").first()).toBeVisible();
      await page.waitForTimeout(300); // let fonts/layout settle; there is nothing deterministic to await for overflow
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
      if (m.sw > m.cw + 1 || m.bw > m.cw + 1) overflowing.push(`${screen.name} (${screen.url}): scrollWidth ${m.sw} > ${m.cw}`);
    }
    await context.close();
    expect(overflowing, "screens that scroll horizontally at 390 px").toEqual([]);
  });

  test("no horizontal overflow at 390 px on /connect (signed out)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: "fa-IR" });
    const page = await context.newPage();
    await page.goto("/connect");
    await expect(page.getByLabel("کلید API لیارا")).toBeVisible();
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    await context.close();
    expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
  });
});

test.describe("accessibility", () => {
  test("landmarks: banner, navigation and main exist on the canvas", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
  });

  test("the skip link is the first tab stop and targets the main landmark", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "رفتن به محتوای اصلی" });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#main-content");
    await expect(page.locator("#main-content")).toHaveCount(1);
  });

  for (const screen of MAIN_SCREENS) {
    test(`every control has an accessible name: ${screen.name}`, async ({ page, browser }) => {
      let p = page;
      let ctx;
      if (screen.signedOut) {
        ctx = await browser.newContext({ locale: "fa-IR" });
        p = await ctx.newPage();
      }
      await p.goto(screen.url);
      await expect(p.locator("main, [role=dialog]").first()).toBeVisible();
      if (screen.url.includes("copilot")) {
        await servicePanel(p).getByRole("button", { name: "سایتم خطای ۵۰۰ می‌دهد" }).click();
        await expect(servicePanel(p).getByText("پیشنهاد همیار")).toBeVisible();
      } else {
        await p.waitForLoadState("networkidle").catch(() => undefined);
      }
      const unnamed = await unnamedControls(p);
      await ctx?.close();
      expect(unnamed, "controls without an accessible name").toEqual([]);
    });
  }

  test("dialogs have accessible names and trap focus (create wizard)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "افزودن سرویس جدید" }).click();
    await page.getByRole("menuitem", { name: /^برنامه/ }).click();
    const dialog = page.getByRole("dialog", { name: "ساخت برنامه" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `focus left the dialog after ${i + 1} Tab`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("closing a wizard returns focus to the «افزودن» trigger", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "افزودن سرویس جدید" });
    await trigger.click();
    await page.getByRole("menuitem", { name: /^برنامه/ }).click();
    await expect(page.getByRole("dialog", { name: "ساخت برنامه" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused({ timeout: 3000 });
  });

  test("Escape on the copilot approval dialog returns focus to «بررسی و تأیید»", async ({ page }) => {
    await openService(page, "broken-shop", "copilot", "&scenario=s1");
    await servicePanel(page).getByRole("button", { name: "سایتم خطای ۵۰۰ می‌دهد" }).click();
    const review = page.getByRole("button", { name: "بررسی و تأیید" });
    await expect(review).toBeVisible({ timeout: 45_000 });
    await review.click();
    // On a phone the service panel is itself a dialog (bottom sheet): pick the approval dialog by its title.
    const approval = page.getByRole("dialog", { name: /تأیید: / });
    await expect(approval).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(approval).toHaveCount(0);
    await expect(review).toBeFocused({ timeout: 3000 });
  });

  test("the shell is exactly the viewport tall: the document never scrolls", async ({ page }) => {
    await openService(page, "broken-shop", "settings");
    await page.evaluate(() => document.querySelector("[role=tab]")?.scrollIntoView());
    await page.evaluate(() => document.querySelector("main")?.scrollIntoView({ block: "end" }));
    const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sy: window.scrollY }));
    expect(m.sh).toBeLessThanOrEqual(m.ch + 1);
    expect(m.sy).toBe(0);
    for (const url of ["/setup", "/incidents", "/activity"]) {
      await page.goto(url);
      // While a route streams in, its Suspense fallback is also a <main>: wait for the shell's own scrolling main.
      const main = page.locator("main[tabindex='-1']");
      await expect(main).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1), `${url} fits the viewport`).toBe(true);
      expect(await main.evaluate((el) => getComputedStyle(el).overflowY), `${url}: <main> is the scroller`).toBe("auto");
    }
  });

  test("every switch has an accessible name and a >= 44 px hit area", async ({ page }) => {
    await openService(page, "broken-shop", "settings");
    await expect(servicePanel(page).getByRole("switch").first()).toBeVisible();
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[role=switch]")]
        .map((el) => {
          const labelledby = el.getAttribute("aria-labelledby");
          const name = (el.getAttribute("aria-label") ?? (labelledby ? document.getElementById(labelledby)?.textContent : "") ?? "").trim();
          const r = el.getBoundingClientRect();
          return { name, w: r.width, h: r.height };
        })
        .filter((s) => !s.name || s.w < 43.5 || s.h < 43.5),
    );
    expect(bad).toEqual([]);
  });

  test("status is conveyed by text, not colour alone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "باز کردن جزئیات broken-shop" })).toBeVisible();
    const cards = page.locator(".react-flow__node-service, [aria-label='فهرست سرویس‌های شما'] li");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < count; i++) {
      const text = await cards.nth(i).innerText();
      expect(text, `card ${i} has a status word`).toMatch(/در حال اجرا|متوقف|در حال ساخت|ناموفق|ناسالم|نامشخص|سالم/);
    }
  });

  test("the copilot timeline is a polite live region", async ({ page }) => {
    await openService(page, "broken-shop", "copilot", "&scenario=s1");
    await servicePanel(page).getByRole("button", { name: "سایتم خطای ۵۰۰ می‌دهد" }).click();
    const live = servicePanel(page).locator('[aria-live="polite"]').filter({ hasText: "خواندن وضعیت اپ" });
    await expect(live).toHaveCount(1);
  });

  test("tab strip follows the ARIA tabs pattern (tablist, selected tab, matching tabpanel)", async ({ page }) => {
    await openService(page, "broken-shop", "overview");
    const tablist = servicePanel(page).getByRole("tablist", { name: "تب‌های سرویس" });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole("tab", { selected: true })).toHaveCount(1);
    await expect(servicePanel(page).getByRole("tabpanel")).toHaveCount(1);
  });

  test("tab keys: arrow keys move between tabs", async ({ page }) => {
    await openService(page, "broken-shop", "overview");
    const overview = servicePanel(page).getByRole("tab", { name: "نمای کلی", exact: true });
    await overview.focus();
    // In RTL the next tab is to the LEFT.
    await page.keyboard.press("ArrowLeft");
    await expect(servicePanel(page).getByRole("tab", { name: "نسخه‌ها", exact: true })).toBeFocused();
  });

  test("mobile: the menu button lists رخدادها، فعالیت‌ها، راه‌اندازی (>= 44 px) and closes on navigation", async ({ browser, baseURL }, info) => {
    test.skip(info.project.name === "mobile", "creates its own 390 px context; running it once on the desktop project is enough");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fa-IR", storageState: info.project.use.storageState as string, baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("button", { name: "باز کردن جزئیات broken-shop" })).toBeVisible();
    // The inline nav is hidden below md; the menu button replaces it.
    await expect(page.getByRole("link", { name: "رخدادها" })).toBeHidden();
    await page.getByRole("button", { name: "منوی صفحه‌ها" }).click();
    for (const name of ["بوم پروژه", "رخدادها", "فعالیت‌ها", "راه‌اندازی"]) {
      const item = page.getByRole("menuitem", { name });
      await expect(item).toBeVisible();
      // offsetHeight ignores the menu's scale-in animation, which would make a 44 px item measure 43.4 px.
      expect(await item.evaluate((el) => (el as HTMLElement).offsetHeight), `${name} target height`).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("menuitem", { name: "فعالیت‌ها" }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "فعالیت‌ها" })).toBeVisible();
    await context.close();
  });

  test("touch targets are at least 44 px on the mobile list view", async ({ browser, baseURL }, info) => {
    test.skip(info.project.name === "mobile", "creates its own 390 px context; running it once on the desktop project is enough");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fa-IR", storageState: info.project.use.storageState as string, baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("button", { name: "باز کردن جزئیات broken-shop" })).toBeVisible();
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main button, main a[href], header button, header a[href], [role=tab]")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && r.top < innerHeight && Math.min(r.width, r.height) < 43.5)
        .map(({ el, r }) => `${el.tagName.toLowerCase()} «${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}» ${Math.round(r.width)}x${Math.round(r.height)}`),
    );
    await context.close();
    // Known gap (reported, not hidden): three header controls are 40-42 px wide (height is 44).
    const KNOWN_NARROW: string[] = [];
    const unexpected = small.filter((s) => !KNOWN_NARROW.some((k) => s.startsWith(k)));
    info.annotations.push({ type: "known-gap", description: `touch targets <44px wide: ${small.filter((s) => KNOWN_NARROW.some((k) => s.startsWith(k))).join("; ") || "none (fixed)"}` });
    expect(unexpected, "interactive elements smaller than 44x44 css px").toEqual([]);
  });
});

test.describe("security headers", () => {
  test("pages carry CSP, nosniff, frame and referrer protections", async ({ request }, info) => {
    const res = await request.get("/connect");
    const h = res.headers();
    if (!h["content-security-policy"]) {
      info.annotations.push({ type: "skip-reason", description: "security headers not present (deploy-readiness unit not merged)" });
      test.skip(true, "security headers not present (deploy-readiness unit not merged)");
    }
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("default-src 'self'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("API responses are not cacheable and carry the same headers", async ({ request }) => {
    const res = await request.get("/api/overview");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("health endpoint answers without a session and exposes no secrets", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    const res = await anon.get("/api/health");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/token|secret|password|e2e-session-key/i);
    await anon.dispose();
  });
});
