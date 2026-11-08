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
  for (const route of ["#/explore", "#/mechanisms/cell", "#/changes", "#/trials", "#/methods"]) {
    await page.goto("/" + route);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
});

const canvasOf = (page: Page) => page.getByLabel(/^3D map of \d+ trials\. /);
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
  await page.getByRole("button", { name: "Outcome: all" }).click();
  // The first outcome that some trial has: unchecking it must hide trials.
  const row = page.getByRole("group", { name: "Outcome" }).locator("label.check").filter({ hasNot: page.locator(".check-n", { hasText: /^0$/ }) }).first();
  const box = row.getByRole("checkbox");
  await expect(box).toBeChecked();
  await row.click();
  await expect(count).not.toHaveText(before ?? "");
  await expect(box).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Outcome: 4 of 5" })).toBeVisible();
});

test("filters live above the map", async ({ page }) => {
  await page.goto("/#/explore");
  await waitForDraw(page);
  const bar = page.getByRole("group", { name: "Map controls" });
  const barBox = (await bar.boundingBox())!;
  const canvasBox = (await canvasOf(page).boundingBox())!;
  expect(barBox.y).toBeLessThan(canvasBox.y);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(canvasBox.y);
  const vw = page.viewportSize()!.width;
  await bar.getByRole("button", { name: "Disease: all" }).click();
  const sheet = page.locator(".popover");
  await expect(sheet).toBeVisible();
  const s = (await sheet.boundingBox())!;
  expect(s.x).toBeGreaterThanOrEqual(0);
  expect(s.x + s.width).toBeLessThanOrEqual(vw);
  if (vw <= 640) {
    // On a phone the popover is a sheet across the bottom of the viewport, above everything else.
    expect(s.width).toBe(vw);
    expect(Math.round(s.y + s.height)).toBe(page.viewportSize()!.height);
    await expect(sheet.getByRole("button", { name: "Done" })).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toHaveCount(0);
  } else {
    await expect(sheet.getByRole("button", { name: "Done" })).toBeHidden();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the wheel over the map zooms it; Reset view returns to 1x", async ({ page }) => {
  await page.goto("/#/explore");
  await waitForDraw(page);
  const canvas = canvasOf(page);
  const reset = page.getByRole("button", { name: "Reset view" });
  await expect(reset).toHaveCount(0);
  const box = (await canvas.boundingBox())!;
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect(reset).toBeVisible();
  // The wheel zoomed the map; it did not scroll the page.
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(canvas).toBeFocused();
});

test("explore canvas draws", async ({ page }) => {
  await page.goto("/#/explore");
  await waitForDraw(page);
});

test("reduced motion keeps the map still and offers no rotation control", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/explore");
  await waitForDraw(page);
  // The map starts still for everyone; under reduced motion the turn is not even offered.
  await expect(page.getByRole("button", { name: /rotation/ })).toHaveCount(0);
  const canvas = canvasOf(page);
  const a = await canvas.screenshot();
  await page.waitForTimeout(500);
  const b = await canvas.screenshot();
  expect(a.equals(b)).toBe(true);
});

test("negative control: without reduced motion the map turns once Play is pressed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#/explore");
  await waitForDraw(page);
  const canvas = canvasOf(page);
  // The map starts still; the turn is opt-in.
  await page.getByRole("button", { name: "Play rotation" }).click();
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

/** Non-transparent canvas pixels: marks, labels and leaders (the plate is cleared to transparent). */
const paintedPixels = (page: Page) =>
  canvasOf(page).evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
    return n;
  });

/** The painted-pixel count once two reads in a row, a frame or more apart, agree. */
async function stablePixels(page: Page): Promise<number> {
  let last = -1;
  let now = await paintedPixels(page);
  await expect
    .poll(async () => {
      last = now;
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      now = await paintedPixels(page);
      return now === last;
    }, { message: "the canvas has settled" })
    .toBe(true);
  return now;
}

test("Mechanism: Select none empties the map; one class alone shows just its trials", async ({ page }) => {
  const file = (await (await page.request.get("/data/explorer.json")).json()) as {
    trials: { mechanisms: string[] }[];
  };
  const antiCd20 = file.trials.filter((t) => t.mechanisms.includes("anti-CD20")).length;
  expect(antiCd20).toBeGreaterThan(0);
  await page.goto("/#/explore");
  await waitForDraw(page);
  await page.getByRole("button", { name: "Mechanism: all" }).click();
  const sheet = page.locator(".popover");
  await sheet.getByRole("button", { name: "Select none" }).click();
  await expect(page.getByText("No trials match these filters.")).toBeVisible();
  await sheet.getByRole("group", { name: "Mechanism" }).locator("label.check").filter({ hasText: "anti-CD20" }).click();
  await expect(page.getByText(new RegExp(`^Showing ${antiCd20} of ${file.trials.length} trials$`))).toBeVisible();
  await expect(page.getByText("No trials match these filters.")).toHaveCount(0);
});

test("Labels: Off takes the cluster labels off the map", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The fixture has no named clusters: name one here, on a trial of the anti-CD20 group.
  await page.route("**/data/explorer.json", async (route) => {
    const res = await route.fetch();
    const f = await res.json();
    const t = f.trials.find((x: { mechanisms: string[] }) => x.mechanisms.includes("anti-CD20"));
    f.clusters = [{ id: 0, label: "Anti-CD20 antibodies (D1)", n: 20, x: t.x, y: t.y, z: t.z }];
    await route.fulfill({ response: res, json: f });
  });
  await page.goto("/#/explore");
  await waitForDraw(page);
  const labels = page.getByRole("group", { name: "Labels" });
  await expect(labels.getByRole("button", { name: "Clusters" })).toHaveAttribute("aria-pressed", "true");
  if (page.viewportSize()!.width <= 640) {
    // On a phone the map carries numerals, named in a key under the canvas: Off takes the key away.
    const key = page.getByRole("list", { name: "Map labels" });
    await expect(key).toContainText("Anti-CD20 antibodies (D1)");
    await labels.getByRole("button", { name: "Off" }).click();
    await expect(key).toHaveCount(0);
    await labels.getByRole("button", { name: "Clusters" }).click();
    await expect(key).toBeVisible();
    return;
  }
  // Labels are redrawn once the web font has loaded: measure once the count has stopped changing.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const withLabels = await stablePixels(page);
  await labels.getByRole("button", { name: "Off" }).click();
  await expect(labels.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => paintedPixels(page), { message: "the label and its leader are gone" }).toBeLessThan(withLabels - 100);
  const without = await paintedPixels(page);
  await labels.getByRole("button", { name: "Clusters" }).click();
  await expect.poll(() => paintedPixels(page), { message: "the label is back" }).toBeGreaterThan(without + 100);
});

test("Colour → Approach paints the map and keys the approaches without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/#/explore");
  await waitForDraw(page);
  await page.getByRole("group", { name: "Colour" }).getByRole("button", { name: "Approach" }).click();
  await expect(page.getByRole("group", { name: "Colour" }).getByRole("button", { name: "Approach" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const key = page.getByRole("list", { name: "Colour key: Approach" });
  await expect(key).toContainText("Targeted drugs");
  await expect(key).toContainText("Unclassified");
  await waitForDraw(page);
  expect(errors).toEqual([]);
});

test("Mechanisms: Cell & transplant opens a kind and its trial", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The fixture has no cell trials: move its first two into aHSCT and mesenchymal cells.
  await page.route("**/data/explorer.json", async (route) => {
    const res = await route.fetch();
    const f = await res.json();
    f.trials[0] = { ...f.trials[0], approaches: ["cell"], kinds: ["ahsct"] };
    f.trials[1] = { ...f.trials[1], approaches: ["cell"], kinds: ["msc"] };
    await route.fulfill({ response: res, json: f });
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Mechanisms" }).click();
  await expect(page).toHaveURL(/#\/mechanisms\/targeted$/);
  const rail = page.getByRole("navigation", { name: /Approaches/ });
  const chip = rail.getByRole("button", { name: /^Cell & transplant/ });
  await chip.click();
  await expect(page).toHaveURL(/#\/mechanisms\/cell$/);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const kind = page.getByRole("button", { name: /^aHSCT/ });
  await kind.click();
  const panel = page.getByRole("complementary", { name: /aHSCT/ });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const vw = page.viewportSize()!.width;
  if (vw <= 640) {
    // On a phone the panel is a bottom sheet across the viewport.
    expect(Math.round(box.width)).toBe(vw);
    expect(Math.round(box.y + box.height)).toBe(page.viewportSize()!.height);
  }
  const link = panel.getByRole("link", { name: NCT });
  const nct = (await link.textContent()) ?? "";
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/trial/${nct}$`));
  await expect(page.getByRole("link", { name: /ClinicalTrials\.gov/ }).first()).toHaveAttribute("href", new RegExp(nct));
  expect(errors).toEqual([]);
});

test("Mechanisms: Show these trials on the map narrows the map", async ({ page }) => {
  await page.goto("/#/mechanisms/nondrug");
  const kind = page.locator(".kind-row").first();
  await kind.click();
  const panel = page.getByRole("complementary");
  await expect(panel).toBeVisible();
  const n = await panel.locator(".side-trials li").count();
  await panel.getByRole("link", { name: "Show these trials on the map" }).click();
  await expect(page).toHaveURL(/#\/explore\?nct=/);
  await expect(page.getByText(new RegExp(`^Showing ${n} of \\d+ trials$`))).toBeVisible();
  await page.getByRole("button", { name: "Show all trials" }).click();
  await expect(page.locator(".explore-only")).toHaveCount(0);
});

test("Mechanisms: the Targeted drugs graph focuses a node and Escape clears it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/mechanisms/targeted");
  const canvas = page.getByRole("img", { name: /^Mechanism graph of \d+ drugs/ });
  await expect(canvas).toBeVisible();
  // The graph has painted marks (the plate is transparent, so any opaque pixel is a mark).
  await expect
    .poll(() =>
      canvas.evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
        return n > 50;
      }),
    )
    .toBe(true);
  // Click the drug node where the layout puts it (GraphCanvas.placeNode: a 28px pad, y up).
  const graph = await page.evaluate(async () => (await fetch("data/mechanisms.json")).json());
  const drug = graph.nodes.find((n: { id: string }) => n.id === "drug:example drug");
  const box = (await canvas.boundingBox())!;
  const PAD = 28;
  const x = PAD + ((drug.x + 1) / 2) * (box.width - 2 * PAD);
  const y = PAD + ((1 - drug.y) / 2) * (box.height - 2 * PAD);
  await canvas.click({ position: { x, y } });
  await expect(page).toHaveURL(/#\/mechanisms\/targeted\?node=drug%3Aexample\+drug$/);
  const panel = page.getByRole("complementary", { name: /example drug/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "MS4A1" })).toBeVisible();
  await expect(panel.getByRole("link", { name: NCT }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/#\/mechanisms\/targeted$/);
  // The search box focuses a node too.
  await page.getByRole("combobox", { name: "Find a drug, target or pathway" }).fill("NFE2");
  await page.getByRole("option", { name: /NFE2L2/ }).first().click();
  await expect(page.getByRole("complementary", { name: /NFE2L2/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Mechanisms: a drug the node cap left out is found, explained and handed to the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The fixture graph draws every drug: add a cut with one drug left out.
  await page.route("**/data/mechanisms.json", async (route) => {
    const g = await (await route.fetch()).json();
    g.cut = {
      drugs: { before: 3, after: 2 },
      targets: { before: 3, after: 2 },
      pathways: { before: 9, after: 9 },
      min_trials: 4,
      all_succeeded: true,
      dropped: [{ drug: "rare drug", n: 1, trials: ["NCT90000001"] }],
    };
    await route.fulfill({ json: g });
  });
  await page.goto("/#/mechanisms/targeted");
  await expect(page.getByRole("img", { name: /^Mechanism graph of 2 drugs/ })).toBeVisible();
  await expect(
    page.getByText("Showing 2 of 3 drugs: every drug credited with a success and those in 4 or more trials."),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Find a drug, target or pathway" }).fill("rare");
  await page.getByRole("option", { name: /rare drug/ }).click();
  const note = page.getByRole("status", { name: "rare drug" });
  await expect(note).toContainText("rare drug is not drawn: it is in 1 trial");
  await note.getByRole("link", { name: "Show its 1 trial on the map" }).click();
  await expect(page).toHaveURL(/#\/explore\?nct=NCT90000001&from=rare\+drug$/);
  expect(errors).toEqual([]);
});
