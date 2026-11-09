import { expect, test, type Page } from "@playwright/test";

const NOTE = /^Statistical estimate from public registry data\. Not a statement about any sponsor or trial\./;
const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test("the Watchlist loads: the first row has an estimate, and the note is shown", async ({ page }) => {
  await page.goto("/#/watchlist");
  await expect(page.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
  const table = page.getByRole("table", { name: /Running trials ranked/ });
  await expect(table).toBeVisible();
  const first = table.locator("tbody tr").first();
  await expect(first).toContainText(/\d+% \(\d+–\d+\)/);
  await expect(first).toContainText(/(above|near|below) typical \d+%/);
  await expect(first.getByRole("img", { name: /^Estimated \d+%/ })).toBeVisible();
  await expect(page.getByText(NOTE)).toBeVisible();
  expect(await overflows(page)).toBe(false);
});

test("the Watchlist sort is kept in the URL", async ({ page }) => {
  await page.goto("/#/watchlist");
  await page.getByRole("button", { name: "Above typical by most" }).click();
  await expect(page).toHaveURL(/sort=difference/);
  await expect(page.getByRole("table", { name: /ranked by difference from typical/ })).toBeVisible();
});

test("a target page shows the stop-risk panel", async ({ page }) => {
  await page.goto("/#/target/cd20");
  const panel = page.getByRole("region", { name: "Running trials, estimated chance of stopping early" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("list", { name: "Running trials by estimate" }).getByRole("listitem").first()).toContainText(/\d+%/);
  await expect(panel.getByText(NOTE)).toBeVisible();
  expect(await overflows(page)).toBe(false);
});
