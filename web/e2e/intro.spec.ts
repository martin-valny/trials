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

test("fits one screen at 1280 x 600 with nothing overlapping", async ({ page }) => {
  await open(page, { width: 1280, height: 600 });
  await expect(page.locator(".intro-list a").first()).toBeVisible();
  expect(await noScroll(page)).toBe(true);
  const boxes = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const [head, list, cap, canvas, key] = [".intro-head", ".intro-list", ".intro-cap", ".intro-canvas", ".intro-key"].map(r);
    return { headBottom: head.bottom, listTop: list.top, capBottom: cap.bottom, canvasTop: canvas.top, canvasBottom: canvas.bottom, keyTop: key.top, keyBottom: key.bottom, vh: window.innerHeight };
  });
  expect(boxes.listTop).toBeGreaterThanOrEqual(boxes.headBottom);
  expect(boxes.canvasTop).toBeGreaterThanOrEqual(boxes.capBottom);
  expect(boxes.keyTop).toBeGreaterThanOrEqual(boxes.canvasBottom - 1);
  expect(boxes.keyBottom).toBeLessThanOrEqual(boxes.vh);
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
  await page.locator(".intro-list a", { hasText: "Changes" }).hover();
  await expect(caption(page)).toContainText("Changes");
  await page.waitForTimeout(6000);
  await expect(caption(page)).toContainText("Changes");
});

test("clicking Approaches opens the approaches page", async ({ page }) => {
  await open(page, { width: 1280, height: 720 });
  const btn = page.locator(".intro-list a", { hasText: "Approaches" });
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
  // The dark plate is in force: the page background is the dark --plate token.
  const plate = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.color = "var(--plate)";
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return { token: c, body: getComputedStyle(document.body).backgroundColor };
  });
  expect(plate.body).toBe(plate.token);
  const rgb = (plate.token.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  expect(rgb.length).toBe(3);
  expect(Math.max(...rgb)).toBeLessThan(128);
  // Some opaque canvas pixel differs from the plate (a transparent or plate-only canvas fails).
  await expect.poll(() => page.locator(".intro-canvas canvas").evaluate((c: HTMLCanvasElement, p: number[]) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 200 && (Math.abs(d[i] - p[0]) > 8 || Math.abs(d[i + 1] - p[1]) > 8 || Math.abs(d[i + 2] - p[2]) > 8)) return true;
    }
    return false;
  }, rgb), { timeout: 5000 }).toBe(true);
  expect(errors).toEqual([]);
});
