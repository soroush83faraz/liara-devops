// Shared helpers for the e2e specs. Everything talks to the app at baseURL and to the FAKE Liara on :4010.
import { expect, type APIRequestContext, type ConsoleMessage, type Page, type Request } from "@playwright/test";
import { FAKE_LIARA_PORT, FAKE_TOKEN, type RecordedCall } from "./fake-liara";

export { FAKE_TOKEN };
export const FAKE_LIARA_URL = `http://127.0.0.1:${FAKE_LIARA_PORT}`;

export interface ConsoleWatch {
  errors: string[];
  stop: () => void;
}

/** Collects console errors, uncaught page errors and 5xx responses of the app's own origin. */
export function watchConsole(page: Page, opts: { ignore?: RegExp[] } = {}): ConsoleWatch {
  const ignore = opts.ignore ?? [];
  const errors: string[] = [];
  const keep = (text: string) => !ignore.some((re) => re.test(text));
  const onConsole = (m: ConsoleMessage) => {
    // /api/probe is rate-limited per account per minute and every spec shares one account: a 429 there is the
    // limiter doing its job (the UI shows «تعداد بررسی‌ها از حد مجاز گذشته است»), not a failure of the page.
    if (m.location().url.includes("/api/probe") && /429/.test(m.text())) return;
    if (m.type() === "error" && keep(m.text())) errors.push(`console.error: ${m.text().slice(0, 300)}`);
  };
  const onPageError = (e: Error) => {
    if (keep(e.message)) errors.push(`pageerror: ${e.message.slice(0, 300)}`);
  };
  const onFailed = async (req: Request) => {
    const res = await req.response().catch(() => null);
    if (res && res.status() >= 500) errors.push(`HTTP ${res.status()} ${req.method()} ${req.url()}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfinished", onFailed);
  return {
    errors,
    stop: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("requestfinished", onFailed);
    },
  };
}

/** Calls the fake Liara received (control route, not part of Liara). */
export async function fakeCalls(request: APIRequestContext): Promise<RecordedCall[]> {
  const res = await request.get(`${FAKE_LIARA_URL}/__calls`);
  return ((await res.json()) as { calls: RecordedCall[] }).calls;
}

export async function resetFakeCalls(request: APIRequestContext): Promise<void> {
  await request.delete(`${FAKE_LIARA_URL}/__calls`);
}

/** Opens a service panel by deep link and waits for the panel landmark. */
export async function openService(page: Page, service: string, tab?: string, extra = ""): Promise<void> {
  const q = new URLSearchParams({ service, ...(tab ? { tab } : {}) });
  await page.goto(`/?${q.toString()}${extra}`);
  await expect(servicePanel(page)).toBeVisible();
}

/** The service panel: an <aside> on desktop, a bottom-sheet dialog on narrow screens. */
export function servicePanel(page: Page) {
  return page.getByRole("complementary", { name: "پنل سرویس" }).or(page.getByRole("dialog").filter({ has: page.getByRole("tablist") }));
}

/** Clicks a tab by its Persian label and waits for it to be selected. */
export async function selectTab(page: Page, label: string): Promise<void> {
  const tab = page.getByRole("tab", { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

export const isMobileProject = (name: string) => name === "mobile";

/** Persian (and Arabic-Indic) digit check: true when the text contains Persian digits and no Latin digits. */
export function onlyPersianDigits(text: string): boolean {
  return /[۰-۹]/.test(text) && !/[0-9]/.test(text);
}
