import { expect, test, type Page } from "@playwright/test";

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - 375);

test("the front door shows the pipeline headline and key numbers", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();
  await expect(h1).toContainText(/running/i);
  await expect(page.getByRole("group", { name: "Key numbers" })).toContainText("trials still running");
  await expect(page.getByRole("link", { name: /^CD20: \d+ trials?/ })).toBeVisible();
});

test("the disease switch changes the URL", async ({ page }) => {
  await page.goto("/");
  const disease = page.getByRole("group", { name: "Disease" });
  await disease.getByRole("button", { name: "MS", exact: true }).click();
  await expect(page).toHaveURL(/disease=MS/);
  await expect(disease.getByRole("button", { name: "MS", exact: true })).toHaveAttribute("aria-pressed", "true");
  await disease.getByRole("button", { name: "All diseases" }).click();
  await expect(page).not.toHaveURL(/disease=/);
});

test("a company name turns on the lens and the chip clears it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Company lens" }).fill("Example");
  await page.getByRole("option", { name: "Example Pharma" }).click();
  await expect(page).toHaveURL(/company=/);
  await expect(page.locator(".lens-chip")).toContainText("Example Pharma");
  await page.getByRole("button", { name: "Clear company lens" }).click();
  await expect(page.locator(".lens-chip")).toHaveCount(0);
  await expect(page).not.toHaveURL(/company=/);
});

test("the nav has no Explore", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" }).getByText(/Explore|Trial map/)).toHaveCount(0);
});

test("phone: By year has no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/#/?view=year");
  await expect(page.locator(".plate, .pipeline, main").first()).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(over).toBe(false);
});

test("row -> target page -> List these trials -> Trials with the banner", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^CD20: \d+ trials?/ }).click();
  await expect(page).toHaveURL(/#\/target\/cd20/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CD20");
  await page.getByRole("link", { name: /^List these \d+ trials →/ }).click();
  await expect(page).toHaveURL(/#\/trials\?nct=.*&from=CD20/);
  const banner = page.locator(".trials-only");
  await expect(banner).toContainText(/^Showing \d+ trials? from CD20/);
  await banner.getByRole("button", { name: "Clear" }).click();
  await expect(banner).toHaveCount(0);
});

test("target page -> mechanism graph -> Back to CD20", async ({ page }) => {
  await page.goto("/#/target/cd20");
  await page.getByRole("link", { name: "Open in the mechanism graph →" }).click();
  await expect(page).toHaveURL(/#\/approaches\/targeted\?node=target:MS4A1&from=cd20/);
  await expect(page.getByRole("img", { name: /^Mechanism graph of \d+ drugs/ })).toBeVisible();
  await page.getByRole("link", { name: "← Back to CD20" }).click();
  await expect(page).toHaveURL(/#\/target\/cd20/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CD20");
});

test("/mechanisms/targeted redirects to /approaches/targeted", async ({ page }) => {
  await page.goto("/#/mechanisms/targeted");
  await expect(page).toHaveURL(/#\/approaches\/targeted$/);
  await expect(page.getByRole("img", { name: /^Mechanism graph of \d+ drugs/ })).toBeVisible();
});

test("no horizontal overflow on the front door and a target page at phone width", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone width only");
  for (const route of ["/", "/#/target/cd20"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await overflow(page), route).toBeLessThanOrEqual(0);
  }
});
