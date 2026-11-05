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

test("no horizontal scroll", async ({ page }) => {
  for (const route of ["#/changes", "#/methods"]) {
    await page.goto("/" + route);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
});
