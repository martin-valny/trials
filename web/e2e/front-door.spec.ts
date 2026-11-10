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
  await expect(page.locator(".pstrip.by-year").first()).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(over).toBe(false);
});

test("row -> target page -> List these trials -> Trials with the banner", async ({ page }) => {
  await page.goto("/");
  // Tap the row where a reader does, on the target's name (top left). The row's centre can fall on a company name,
  // which is its own button (the company lens) layered over the row link.
  await page.getByRole("link", { name: /^CD20: \d+ trials?/ }).click({ position: { x: 12, y: 14 } });
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

test("By disease marks approved cells with a floor rule", async ({ page }) => {
  await page.goto("/#/?view=disease");
  await expect(page.locator(".cell.ap .floor").first()).toBeAttached();
});

test("the target page has panel e, with a link to an approved drug", async ({ page }) => {
  await page.goto("/#/target/cd20");
  await expect(page.getByRole("heading", { name: "CD20 by disease" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ocrelizumab" })).toBeVisible();
});

// The fixture has one sponsor-complete row, so the lens-miss and historical cases need a patched pipeline.json:
// a third company, and CD19 with 12 stopped trials of it plus a current approval for MS.
async function patchPipeline(page: Page) {
  await page.route("**/data/pipeline.json", async (route) => {
    const res = await route.fetch();
    const f = await res.json();
    f.sponsors.push({ kind: "industry", parent: "Other Co", raw: "Other Co" });
    const cd19 = f.rows.find((r: { id: string }) => r.id === "cd19");
    cd19.marks = Array.from({ length: 12 }, (_, i) => ({ c: 2, drug: "x", dz: ["MS"], n: `NCT9100000${i}`, s: "stop", sp: 2, y: 2015, y2: 2017 }));
    cd19.ap = { MS: [{ d: "inebilizumab", src: ["hand"], url: "https://example.org/x" }] };
    await route.fulfill({ response: res, json: f });
  });
}

// Opacity is multiplicative down the tree, so the floor and every ancestor up to and including the row must each be 1.
const opacities = (page: Page, sel: string) =>
  page.locator(sel).evaluate((el) => {
    const out: string[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      out.push(getComputedStyle(n).opacity);
      if (n.classList.contains("row")) break;
    }
    return out;
  });

test("desktop: the floor rule stays fully opaque under a lens that misses the row", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await patchPipeline(page);
  await page.goto("/#/?view=disease&company=Other%20Co");
  const miss = page.locator('.row.miss[data-row="cd20"]');
  await expect(miss).toHaveCount(1);
  const ops = await opacities(page, '.row[data-row="cd20"] [data-cell="MS"] .floor');
  expect(ops.length).toBeGreaterThan(1);
  expect(ops.every((o) => o === "1")).toBe(true);
  // Contrast: a mark in the same dimmed row is dimmed, so the check can fail.
  expect(await page.locator('.row[data-row="cd20"] [data-cell="MS"] .m').first().evaluate((el) => getComputedStyle(el).opacity)).toBe("0.45");
});

test("desktop: the floor rule stays fully opaque in a Mostly historical row", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await patchPipeline(page);
  await page.goto("/#/?view=disease");
  await expect(page.locator('.row.hist[data-row="cd19"]')).toHaveCount(1);
  const ops = await opacities(page, '.row[data-row="cd19"] [data-cell="MS"] .floor');
  expect(ops.length).toBeGreaterThan(1);
  expect(ops.every((o) => o === "1")).toBe(true);
  expect(await page.locator('.row[data-row="cd19"] [data-cell="MS"] .m').first().evaluate((el) => getComputedStyle(el).opacity)).toBe("0.62");
});

test("?panel=f lands on panel f, below the sticky contents strip", async ({ page }) => {
  await page.goto("/#/target/cd20?panel=f");
  const h = page.getByRole("heading", { name: "Running trials, estimated chance of stopping early" });
  await expect(h).toBeInViewport();
  const strip = page.getByRole("navigation", { name: "Panels on this page" });
  const [s, t] = await Promise.all([strip.boundingBox(), h.boundingBox()]);
  expect(t!.y).toBeGreaterThanOrEqual(s!.y + s!.height);
});

test("keyboard: Enter on the strip's g link puts focus on panel g's heading", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "keyboard");
  await page.goto("/#/target/cd20");
  const g = page.getByRole("navigation", { name: "Panels on this page" }).getByRole("link", { name: /^g Diligence/ });
  await expect(g).toBeVisible();
  // Tab from the strip's first link along to g.
  await page.getByRole("navigation", { name: "Panels on this page" }).getByRole("link").first().focus();
  for (let i = 0; i < 10 && !(await g.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(g).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pg")).toBeFocused();
  await expect(page).toHaveURL(/panel=g/);
});

test("clicking f in the strip marks f current once the scroll has settled", async ({ page }) => {
  await page.goto("/#/target/cd20");
  const strip = page.getByRole("navigation", { name: "Panels on this page" });
  await expect(page.getByRole("heading", { name: "Running trials, estimated chance of stopping early" })).toBeAttached();
  await strip.getByRole("link", { name: /^f Stop chance/ }).click();
  await expect(page).toHaveURL(/panel=f/);
  await page.waitForTimeout(1200);
  await expect(strip.getByRole("link", { name: /^f Stop chance/ })).toHaveAttribute("aria-current", "location");
  await expect(strip.locator('[aria-current="location"]')).toHaveCount(1);
});

test("?panel=f scrolls there without putting focus on the heading", async ({ page }) => {
  await page.goto("/#/target/cd20?panel=f");
  await expect(page.getByRole("heading", { name: "Running trials, estimated chance of stopping early" })).toBeInViewport();
  await expect(page.locator("#pf")).not.toBeFocused();
});
