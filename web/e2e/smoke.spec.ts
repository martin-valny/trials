import { expect, test, type Page } from "@playwright/test";

test("feed -> trial -> methods", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/#\/explore$/);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Changes" }).click();
  await expect(page).toHaveURL(/#\/changes$/);
  const firstRow = page.locator("table.changes tbody tr").first();
  await expect(firstRow).toBeVisible();

  const link = firstRow.getByRole("link", { name: /^NCT\d+$/ });
  const nct = (await link.textContent()) ?? "";
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/trial/${nct}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(nct);

  await page.getByRole("link", { name: "Methods" }).click();
  await expect(page.getByRole("heading", { name: "Methods", level: 1 })).toBeVisible();
});

test("trials list opens a trial", async ({ page }) => {
  await page.goto("/#/trials");
  const first = page.locator("table.trials tbody tr").first();
  await expect(first).toBeVisible();
  const nct = (await first.getByRole("link", { name: /^NCT\d+$/ }).textContent()) ?? "";
  await first.getByRole("link", { name: nct }).click();
  await expect(page).toHaveURL(new RegExp(`#/trial/${nct}$`));
});

test("no horizontal scroll", async ({ page }) => {
  for (const route of ["#/explore", "#/changes", "#/trials", "#/methods"]) {
    await page.goto("/" + route);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
});

const canvasOf = (page: Page) => page.getByLabel(/^3D map of \d+ trials$/);
const NCT = /NCT\d+/;

/** Waits until the canvas has painted marks. The plate is transparent (clearRect), so any non-transparent pixel is a mark. */
async function waitForDraw(page: Page) {
  const canvas = canvasOf(page);
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      () =>
        canvas.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
          return n > Math.max(20, Math.floor((c.width * c.height) / 10000));
        }),
      { message: "canvas has painted marks" },
    )
    .toBe(true);
}

test("explore selects a trial by search and opens its page", async ({ page }) => {
  await page.goto("/#/explore");
  await waitForDraw(page);
  const panel = page.getByRole("region", { name: "Selected trial" });
  await expect(panel).not.toContainText(NCT);
  await page.getByLabel("Find a trial").fill("NCT");
  await page.getByLabel("Find a trial").press("Enter");
  await expect(panel).toContainText(NCT);
  const nct = ((await panel.textContent()) ?? "").match(NCT)![0];
  await panel.getByRole("link", { name: "Trial page" }).click();
  await expect(page).toHaveURL(new RegExp(`#/trial/${nct}$`));
});

test("explore selects a trial by clicking the map", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/explore");
  await waitForDraw(page);
  const panel = page.getByRole("region", { name: "Selected trial" });
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText(NCT);
  const box = (await canvasOf(page).boundingBox())!;
  // Click where dots were actually drawn (opaque pixels, one per 16px cell), not on a blind grid.
  const spots = await canvasOf(page).evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const sx = c.width / c.clientWidth;
    const sy = c.height / c.clientHeight;
    const seen = new Set<string>();
    const out: [number, number][] = [];
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 200) continue;
      const px = (i - 3) / 4;
      const x = (px % c.width) / sx;
      const y = Math.floor(px / c.width) / sy;
      const cell = `${Math.floor(x / 16)},${Math.floor(y / 16)}`;
      if (seen.has(cell)) continue;
      seen.add(cell);
      out.push([x, y]);
    }
    return out;
  });
  expect(spots.length, "the map drew opaque dots").toBeGreaterThan(0);
  let found = false;
  for (const [x, y] of spots.slice(0, 40)) {
    await page.mouse.click(box.x + x, box.y + y);
    try {
      await expect(panel).toContainText(NCT, { timeout: 300 });
      found = true;
      break;
    } catch {
      /* a label or an edge pixel, not a dot */
    }
  }
  expect(found, "a click on the map selected a trial").toBe(true);
  const nct = ((await panel.textContent()) ?? "").match(NCT)![0];
  await panel.getByRole("link", { name: "Trial page" }).click();
  await expect(page).toHaveURL(new RegExp(`#/trial/${nct}$`));
});

test("explore filters change count", async ({ page }) => {
  await page.goto("/#/explore");
  const count = page.getByText(/^Showing \d+ of \d+ trials$/);
  await expect(count).toBeVisible();
  const before = await count.textContent();
  const pill = page.getByRole("group", { name: "Outcome" }).getByRole("button").filter({ hasNot: page.locator(".pill-n", { hasText: /^0$/ }) }).first();
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await pill.click();
  await expect(count).not.toHaveText(before ?? "");
  await expect(pill).toHaveAttribute("aria-pressed", "false");
});

test("explore canvas draws", async ({ page }) => {
  await page.goto("/#/explore");
  await waitForDraw(page);
});

test("reduced motion keeps the map still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/explore");
  await waitForDraw(page);
  const canvas = canvasOf(page);
  const a = await canvas.screenshot();
  await page.waitForTimeout(500);
  const b = await canvas.screenshot();
  expect(a.equals(b)).toBe(true);
});

test("negative control: without reduced motion the map moves", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#/explore");
  await waitForDraw(page);
  const canvas = canvasOf(page);
  const a = await canvas.screenshot();
  await page.waitForTimeout(500);
  const b = await canvas.screenshot();
  expect(a.equals(b)).toBe(false);
});

test("theme switch persists across reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/methods");
  const button = page.getByRole("button", { name: /^theme:/i });
  await expect(button).toHaveAccessibleName(/theme: system/i);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await button.click();
  await expect(button).toHaveAccessibleName(/theme: light/i);
  await button.click();
  await expect(button).toHaveAccessibleName(/theme: dark/i);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/#/explore", { waitUntil: "domcontentloaded" });
  // Set by the pre-paint script, before React or the data load.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.getByRole("button", { name: /theme: dark/i })).toHaveText(/Dark/);
});
