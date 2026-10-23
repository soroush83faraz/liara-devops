import { expect, test, type Locator, type Page } from "@playwright/test";
import { fakeCalls, onlyPersianDigits, resetFakeCalls, watchConsole } from "./helpers";

async function openWizard(page: Page, item: RegExp) {
  await page.goto("/");
  await page.getByRole("button", { name: "افزودن سرویس جدید" }).click();
  await page.getByRole("menuitem", { name: item }).click();
  return page.getByRole("dialog");
}

async function next(dialog: Locator) {
  await dialog.getByRole("button", { name: "بعدی", exact: true }).click();
}

test.describe("create menu", () => {
  test("«+ افزودن» lists network, app and database and opens the matching wizard", async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto("/");
    const add = page.getByRole("button", { name: "افزودن سرویس جدید" });
    await add.click();
    await expect(page.getByRole("menuitem")).toHaveText([/شبکه‌ی خصوصی/, /برنامه/, /پایگاه داده/]);

    await page.getByRole("menuitem", { name: /شبکه‌ی خصوصی/ }).click();
    await expect(page.getByRole("dialog", { name: "ساخت شبکه‌ی خصوصی" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await add.click();
    await page.getByRole("menuitem", { name: /پایگاه داده/ }).click();
    await expect(page.getByRole("dialog", { name: "ساخت پایگاه داده" })).toBeVisible();
    await page.keyboard.press("Escape");

    await add.click();
    await page.getByRole("menuitem", { name: /^برنامه/ }).click();
    await expect(page.getByRole("dialog", { name: "ساخت برنامه" })).toBeVisible();
    watch.stop();
    expect(watch.errors).toEqual([]);
  });

  test("app wizard: name validation gates the first step", async ({ page }) => {
    const dialog = await openWizard(page, /^برنامه/);
    await expect(dialog.getByText("مرحله‌ی ۱ از ۵")).toBeVisible();
    const name = dialog.getByLabel("نام برنامه");
    await name.fill("Bad Name!");
    await expect(dialog.getByText(/فقط حروف کوچک انگلیسی/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "بعدی", exact: true })).toBeDisabled();
    await name.fill("new-app");
    await expect(dialog.getByRole("button", { name: "بعدی", exact: true })).toBeEnabled();
  });

  test("app wizard: cannot submit without the typed name; cost lines use Persian digits; submit reaches the (fake) Liara", async ({ page, request }) => {
    await resetFakeCalls(request);
    const dialog = await openWizard(page, /^برنامه/);
    await dialog.getByLabel("نام برنامه").fill("new-app");
    await next(dialog);
    await dialog.getByText("Node.js", { exact: true }).click();
    await next(dialog);

    // Plans come from the fake /v1/me; every price line is Persian-digit text.
    await dialog.getByText("iran-g2-small", { exact: true }).click();
    const priceLines = dialog.getByText(/تومان در ساعت/);
    await expect(priceLines.first()).toBeVisible();
    for (const text of await priceLines.allInnerTexts()) expect(onlyPersianDigits(text), `Persian digits in «${text}»`).toBe(true);
    await next(dialog);
    // Network step: stay with the default («بدون شبکه») and move on.
    await next(dialog);

    // Review step: summary, cost, acknowledgement and the type-the-name gate.
    await expect(dialog.getByText("بازبینی نهایی")).toBeVisible();
    const cost = dialog.getByText(/هزینه/).first();
    await expect(cost).toBeVisible();
    const submit = dialog.getByRole("button", { name: "ساخت برنامه", exact: true });
    await expect(submit).toBeDisabled();

    const typed = dialog.getByRole("textbox", { name: /نام/ }).last();
    await typed.fill("new-ap");
    await expect(dialog.getByText("نام با نمونه یکسان نیست.")).toBeVisible();
    await expect(submit).toBeDisabled();
    await typed.fill("new-app");
    await expect(dialog.getByText("نام تأیید شد.")).toBeVisible();
    // The cost acknowledgement is still required.
    await expect(submit).toBeDisabled();
    await dialog.getByRole("switch", { name: /می‌دانم که ساخت این منبع هزینه دارد/ }).click();
    await expect(submit).toBeEnabled();
    expect((await fakeCalls(request)).filter((c) => c.method === "POST")).toEqual([]);

    await submit.click();
    await expect(dialog.getByText("برنامه ساخته شد")).toBeVisible();
    const posts = (await fakeCalls(request)).filter((c) => c.method === "POST" && c.path === "/v1/projects");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ name: "new-app", planID: "iran-g2-small", platform: "node" });
    expect(posts[0].authorized).toBe(true);
  });

  test("database wizard shows engines from the fake catalog", async ({ page }) => {
    const dialog = await openWizard(page, /پایگاه داده/);
    await expect(dialog.getByText("PostgreSQL")).toBeVisible();
    await expect(dialog.getByText("Redis")).toBeVisible();
  });

  test("network wizard: creating needs the typed name too", async ({ page }) => {
    const dialog = await openWizard(page, /شبکه‌ی خصوصی/);
    await dialog.getByLabel("نام شبکه").fill("my-net");
    await next(dialog);
    const submit = dialog.getByRole("button", { name: "ساخت شبکه", exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByRole("textbox").last().fill("wrong-net");
    await expect(submit).toBeDisabled();
    await dialog.getByRole("textbox").last().fill("my-net");
    await expect(submit).toBeEnabled();
  });
});
