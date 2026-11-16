import { expect, test, type Page } from "@playwright/test";
import { noRecordedDiligence } from "./isolate";

const NOTE = /^A statistical pattern from similar past trials, read from the registry record alone\./;
const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);


test.beforeEach(({ page }) => noRecordedDiligence(page));

test("the Stop risk page loads: the first row has an estimate, and the note is shown", async ({ page }) => {
  await page.goto("/#/stop-risk");
  await expect(page.getByRole("heading", { level: 1, name: "Stop risk" })).toBeVisible();
  const table = page.getByRole("table", { name: /Running trials ranked/ });
  await expect(table).toBeVisible();
  const first = table.locator("tbody tr").first();
  await expect(first).toContainText(/\d+% \(\d+–\d+\)/);
  await expect(first).toContainText(/(above|near|below) typical \d+%/);
  await expect(first.getByRole("img", { name: /^Estimated \d+%/ })).toBeVisible();
  await expect(page.getByText(NOTE)).toBeVisible();
  expect(await overflows(page)).toBe(false);
});

test("the Stop risk sort is kept in the URL, and old /watchlist links land there", async ({ page }) => {
  await page.goto("/#/watchlist");
  await expect(page).toHaveURL(/#\/stop-risk/);
  await page.getByRole("button", { name: "Furthest above typical" }).click();
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

// v2 card (synthetic fixture numbers): Methods shows the before/after table and the credit line.
test("Methods shows the v2 before/after table and credit line without horizontal scroll", async ({ page }) => {
  await page.route("**/data/risk.json", (r) => r.fulfill({ path: "tests/fixtures/risk-variants/risk-v2.json" }));
  await page.goto("/#/methods?s=stop-risk");
  const section = page.locator("section#stop-risk");
  const table = section.getByRole("table", { name: /Before and after/ });
  await expect(table).toBeVisible();
  await expect(table.locator("tr[data-row='v2_history']")).toContainText("v2 plus edit history (not used)");
  await expect(section.getByRole("table", { name: /Accuracy on later trials/ })).toHaveCount(0);
  await expect(section.locator("[data-credit]")).toContainText(/^Data: ClinicalTrials\.gov, via AACT/);
  expect(await overflows(page)).toBe(false);
});

test("Methods keeps the v1 text and adds the before/after table when v2 did not ship", async ({ page }) => {
  await page.route("**/data/risk.json", (r) => r.fulfill({ path: "tests/fixtures/risk-variants/risk-v1-comparison.json" }));
  await page.goto("/#/methods?s=stop-risk");
  const section = page.locator("section#stop-risk");
  await expect(section.getByRole("table", { name: /Accuracy on later trials/ })).toBeVisible();
  await expect(section.getByRole("table", { name: /Before and after/ })).toBeVisible();
  await expect(section).toContainText("so the earlier model stays on the site");
  expect(await overflows(page)).toBe(false);
});
