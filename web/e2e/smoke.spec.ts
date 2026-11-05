import { expect, test } from "@playwright/test";

test("feed -> trial -> methods", async ({ page }) => {
  await page.goto("/");
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
  for (const route of ["#/changes", "#/trials", "#/methods"]) {
    await page.goto("/" + route);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
});
