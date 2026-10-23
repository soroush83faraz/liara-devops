import { expect, test } from "@playwright/test";
import { sealData } from "iron-session";
import { E2E_SESSION_KEY } from "./paths";
import { FAKE_TOKEN, watchConsole } from "./helpers";

// These tests start signed out (no stored session).
test.use({ storageState: { cookies: [], origins: [] } });

const CONNECT_URL = /\/connect$/;

test.describe("connect", () => {
  test("page is Persian and right-to-left, with a labelled form", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/connect");
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page).toHaveTitle(/اتصال به لیارا/);
    await expect(page.getByLabel("کلید API لیارا")).toBeVisible();
    await expect(page.getByRole("button", { name: "اتصال", exact: true })).toBeEnabled();
    expect(watch.errors).toEqual([]);
  });

  test("placeholders: Persian placeholder is RTL in the normal font; a typed token is LTR monospace and clear of the eye button", async ({ page }) => {
    await page.goto("/connect");
    const token = page.getByLabel("کلید API لیارا");
    const team = page.getByLabel(/شناسه‌ی تیم/);
    expect(await token.evaluate((el) => ({ dir: getComputedStyle(el).direction, mono: /mono|Menlo|Consolas/i.test(getComputedStyle(el).fontFamily) }))).toEqual({ dir: "rtl", mono: false });
    // The team-ID sample is an isolated LTR run (no «5» glued to the wrong side of the Persian word).
    expect(await team.getAttribute("placeholder")).toContain("\u20665f3a9c\u2069");
    await token.fill("abc123");
    expect(await token.evaluate((el) => ({ dir: getComputedStyle(el).direction, mono: /mono|Menlo|Consolas/i.test(getComputedStyle(el).fontFamily) }))).toEqual({ dir: "ltr", mono: true });
    // The eye button must not sit on top of the text: the field's physical left padding clears it.
    const geometry = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("input[name=token]")!;
      const eye = input.parentElement!.querySelector("button")!;
      return { padLeft: parseFloat(getComputedStyle(input).paddingLeft), eyeRight: eye.getBoundingClientRect().right - input.getBoundingClientRect().left };
    });
    expect(geometry.padLeft).toBeGreaterThanOrEqual(geometry.eyeRight);
  });

  test("a token the fake Liara rejects (401) shows the Persian error and stays on /connect", async ({ page }) => {
    await page.goto("/connect");
    await page.getByLabel("کلید API لیارا").fill("wrong-token-0000000");
    await page.getByRole("button", { name: "اتصال", exact: true }).click();
    await expect(page.getByText("کلید معتبر نیست یا منقضی شده")).toBeVisible();
    await expect(page).toHaveURL(CONNECT_URL);
    // The rejected token is not echoed back into the page text.
    await expect(page.locator("body")).not.toContainText("wrong-token-0000000");
  });

  test("an empty token is refused client-side with the required-field message", async ({ page }) => {
    await page.goto("/connect");
    await page.getByRole("button", { name: "اتصال", exact: true }).click();
    await expect(page.getByText("کلید API را وارد کنید.")).toBeVisible();
    await expect(page).toHaveURL(CONNECT_URL);
  });

  test("a valid token reaches the canvas; the session cookie is httpOnly and the token never reaches JS", async ({ page, context }) => {
    await page.goto("/connect");
    await page.getByLabel("کلید API لیارا").fill(FAKE_TOKEN);
    await page.getByRole("button", { name: "اتصال", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await expect(page.getByRole("heading", { level: 1, name: "نقشه‌ی سرویس‌ها" })).toBeVisible();
    await expect(page.getByRole("button", { name: "باز کردن جزئیات broken-shop" })).toBeVisible();

    const cookie = (await context.cookies()).find((c) => c.name === "hl_session");
    expect(cookie, "session cookie").toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.value).not.toContain(FAKE_TOKEN);
    expect(await page.evaluate(() => document.cookie)).not.toContain("hl_session");
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(FAKE_TOKEN);

    // The browser-visible session endpoint exposes no token field.
    const me = await page.request.get("/api/session");
    expect(me.status()).toBe(200);
    expect(JSON.stringify(await me.json())).not.toContain(FAKE_TOKEN);
  });

  test("visiting the canvas without a session redirects to /connect", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(CONNECT_URL);
  });

  test("a forged expired session cookie is treated as signed out and redirects to /connect", async ({ page, context }) => {
    const expired = await sealData({ token: FAKE_TOKEN, accountId: "forged-account" }, { password: E2E_SESSION_KEY, ttl: -600 });
    await context.addCookies([{ name: "hl_session", value: expired, url: "http://127.0.0.1:3200", httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/");
    await expect(page).toHaveURL(CONNECT_URL);
    const res = await page.request.get("/api/overview");
    expect(res.status()).toBe(401);
  });

  test("a garbage session cookie is rejected too", async ({ page, context }) => {
    await context.addCookies([{ name: "hl_session", value: "not-a-real-seal", url: "http://127.0.0.1:3200", httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/");
    await expect(page).toHaveURL(CONNECT_URL);
  });

  test("API routes answer 401 with a Persian message when signed out", async ({ request }) => {
    for (const path of ["/api/overview", "/api/apps/broken-shop/envs", "/api/plans"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message, path).toMatch(/[؀-ۿ]/);
    }
  });

  test("cross-origin mutations are refused (CSRF guard)", async ({ request }) => {
    const res = await request.post("/api/session", { data: { token: FAKE_TOKEN }, headers: { origin: "https://evil.example" } });
    expect(res.status()).toBe(403);
  });
});
