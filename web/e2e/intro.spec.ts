import { expect, test, type Page } from "@playwright/test";

const caption = (page: Page) => page.locator(".intro-cap b");

async function open(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator(".intro-h1")).toContainText("clinical trials in");
  await expect(page.locator(".intro-canvas canvas")).toBeVisible();
}

const noScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);

test("fits one screen at 1280 x 720", async ({ page }) => {
  await open(page, { width: 1280, height: 720 });
  expect(await noScroll(page)).toBe(true);
});

test("fits one screen at 375 x 667", async ({ page }) => {
  await open(page, { width: 375, height: 667 });
  expect(await noScroll(page)).toBe(true);
});

test("the tour moves from All to Pipeline", async ({ page }) => {
  await open(page, { width: 1280, height: 720 });
  await expect(caption(page)).toHaveText("All trials.");
  await expect(caption(page)).toContainText("Pipeline", { timeout: 5000 });
});

test("hovering Changes holds the tour", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "hover is a desktop gesture");
  await open(page, { width: 1280, height: 720 });
  await page.locator(".intro-list button", { hasText: "Changes" }).hover();
  await expect(caption(page)).toContainText("Changes");
  await page.waitForTimeout(6000);
  await expect(caption(page)).toContainText("Changes");
});

test("clicking Approaches opens the approaches page", async ({ page }) => {
  await open(page, { width: 1280, height: 720 });
  const btn = page.locator(".intro-list button", { hasText: "Approaches" });
  await btn.click();
  await expect(page).toHaveURL(/#\/approaches\//);
});

test("reduced motion: no tour", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { width: 1280, height: 720 });
  await expect(caption(page)).toHaveText("All trials.");
  await page.waitForTimeout(6000);
  await expect(caption(page)).toHaveText("All trials.");
});

test("a query on / redirects to /pipeline with the same query", async ({ page }) => {
  await page.goto("/#/?view=year");
  await expect(page).toHaveURL(/#\/pipeline\?view=year$/);
});

test("dark theme: no console errors and the canvas is not blank", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, { width: 1280, height: 720 });
  const button = page.getByRole("button", { name: /^theme:/i });
  for (let i = 0; i < 3 && !/theme: dark/i.test((await button.getAttribute("aria-label")) ?? (await button.innerText())); i++) await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForTimeout(1500);
  const differs = await page.locator(".intro-canvas canvas").evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2], d[3]];
    for (let i = 0; i < d.length; i += 4) if (d[i] !== bg[0] || d[i + 1] !== bg[1] || d[i + 2] !== bg[2] || d[i + 3] !== bg[3]) return true;
    return false;
  });
  expect(differs).toBe(true);
  expect(errors).toEqual([]);
});
