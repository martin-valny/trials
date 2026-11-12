import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { noRecordedDiligence } from "./isolate";

// The synthetic run lives only in the test fixtures (R6: nothing fake ships in web/public/diligence/),
// so the recorded-run path is served by route interception. The build has no agent URL: this is the offline path.
const RUN = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "diligence", "cd20__MS.json"), "utf-8");
const LABEL = "AI judgement from public data, not investment advice";
const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);


test.beforeEach(({ page }) => noRecordedDiligence(page));

test("a target page shows a recorded diligence run with its checked memo", async ({ page }) => {
  await page.route("**/diligence/cd20__MS.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: RUN }));
  await page.goto("/#/target/cd20?disease=MS");
  const panel = page.getByRole("region", { name: "Diligence (AI agent)" });
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByText("Recorded run, 9 Nov 2026")).toBeVisible();
  await expect(panel.getByRole("list", { name: "Agent trace" }).getByRole("listitem")).toHaveCount(7);
  await expect(panel.getByRole("link", { name: /^NCT90000001, ClinicalTrials\.gov/ }).first()).toHaveAttribute(
    "href",
    "https://clinicaltrials.gov/study/NCT90000001",
  );
  await expect(panel.getByText(/^partly supported — /)).toBeVisible();
  await expect(panel.getByRole("region", { name: "Removed by the checker" })).toContainText("A competing programme");
  await expect(panel.getByRole("region", { name: "Judgement" })).toContainText("Mixed on further investment");
  await expect(panel.getByText(LABEL)).toBeVisible();
  // Offline build: no run button, no Flag.
  await expect(panel.getByRole("button", { name: /Run (diligence|again)/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^Flag/ })).toHaveCount(0);
  expect(await overflows(page)).toBe(false);
});

test("without a recorded run the offline panel links to an example once the example is recorded", async ({ page }) => {
  await page.route("**/diligence/cd20__MS.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: RUN }));
  await page.goto("/#/target/cd20");
  const panel = page.getByRole("region", { name: "Diligence (AI agent)" });
  await expect(panel.getByText("The diligence agent is offline.")).toBeVisible();
  await expect(panel.getByRole("link", { name: /recorded example/ })).toHaveAttribute("href", "#/target/cd20?disease=MS&panel=g");
});

test("no example link while the example has no recording (R47: no dead end)", async ({ page }) => {
  await page.goto("/#/target/cd20");
  const panel = page.getByRole("region", { name: "Diligence (AI agent)" });
  await expect(panel.getByText("The diligence agent is offline.")).toBeVisible();
  await expect(panel.getByText(/No run has been recorded for this target yet/)).toBeVisible();
  await expect(panel.getByRole("link", { name: /recorded example/ })).toHaveCount(0);
});

// ---- The centrepiece: front-door band, nav item and /diligence page (spec sections 4 to 6) ----
// Closed = the index is absent (the preview server answers 404 for it). Recorded = the synthetic index below.
const INDEX = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "diligence", "index.json"), "utf-8");
const NAV_ORDER = ["Pipeline", "Diligence", "Watchlist", "Approaches", "Changes", "Trials", "Methods"];

async function record(page: Page) {
  await page.route("**/diligence/index.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: INDEX }));
  await page.route("**/diligence/cd20__MS.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: RUN }));
}
async function close(page: Page) {
  await page.route("**/diligence/index.json", (r) => r.fulfill({ status: 404, body: "" }));
}
const navLabels = (page: Page) => page.getByRole("navigation", { name: "Main" }).getByRole("link").allInnerTexts();

test("closed: no band, no nav item, and /diligence goes to Methods", async ({ page, isMobile }) => {
  await close(page);
  await page.goto("/#/pipeline");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "AI diligence" })).toHaveCount(0);
  if (!isMobile) {
    const labels = (await navLabels(page)).map((s) => s.trim());
    expect(labels).not.toContain("Diligence");
    expect(labels.at(-1)).toBe("Methods");
  }
  await expect(page.getByText("An AI agent drafts a checked diligence memo on each target page.")).toBeVisible();
  await page.goto("/#/target/cd20?disease=MS");
  const strip = page.getByRole("navigation", { name: "Panels on this page" });
  await expect(strip.getByRole("link").last()).toContainText(/^g\s*Diligence/);
  await page.goto("/#/diligence");
  await expect(page).toHaveURL(/#\/methods\?s=diligence/);
});

test("recorded: the nav lists Diligence second", async ({ page, isMobile }) => {
  test.skip(isMobile, "the nav is a menu on a phone");
  await record(page);
  await page.goto("/#/pipeline");
  await expect(page.getByRole("link", { name: "Diligence", exact: true })).toBeVisible();
  expect((await navLabels(page)).map((s) => s.trim())).toEqual(NAV_ORDER);
});

test("recorded: the front-door band opens the memo at the diligence panel", async ({ page, isMobile }) => {
  await record(page);
  await page.goto("/#/pipeline");
  const band = page.getByRole("region", { name: "AI diligence" });
  await expect(band).toBeVisible();
  await expect(band.getByText(LABEL)).toBeVisible();
  expect(await overflows(page)).toBe(false);
  if (isMobile) {
    // No picker on a phone: one link to the Diligence page.
    await expect(band.getByRole("combobox")).toHaveCount(0);
    await expect(band.getByRole("link", { name: "Open a recorded memo →" })).toHaveAttribute("href", "#/diligence");
    await band.getByRole("link", { name: "Open a recorded memo →" }).click();
    await expect(page).toHaveURL(/#\/diligence/);
    await page.getByRole("link", { name: /^Open memo/ }).click();
  } else {
    await band.getByRole("button", { name: "Open memo →" }).click();
  }
  await expect(page).toHaveURL(/#\/target\/cd20\?disease=MS&panel=a/);
  // Diligence is panel a: first in the contents strip, with the memo shown.
  const strip = page.getByRole("navigation", { name: "Panels on this page" });
  await expect(strip.getByRole("link").first()).toContainText(/diligence/i);
  const panel = page.getByRole("region", { name: "Diligence (AI agent)" });
  await expect(panel.getByRole("region", { name: "Judgement" })).toContainText("Mixed on further investment");
  expect(await overflows(page)).toBe(false);
});

test("recorded: /diligence lists the memo and opens it", async ({ page }) => {
  await record(page);
  await page.goto("/#/diligence");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI diligence");
  await expect(page.getByText(LABEL).first()).toBeVisible();
  const row = page.getByRole("row", { name: /CD20/ });
  await expect(row).toContainText("Multiple sclerosis");
  await expect(row).toContainText(/mixed/i);
  expect(await overflows(page)).toBe(false);
  await row.getByRole("link", { name: /^Open memo/ }).click();
  await expect(page).toHaveURL(/#\/target\/cd20\?disease=MS&panel=a/);
});

test("recorded: a target with no memo says so and links to /diligence", async ({ page }) => {
  await record(page);
  await page.goto("/#/target/cd20");
  const panel = page.getByRole("region", { name: "Diligence (AI agent)" });
  await expect(panel.getByText("No recorded memo for this target yet.")).toBeVisible();
  await expect(panel.getByRole("link", { name: "See recorded memos →" })).toHaveAttribute("href", "#/diligence");
  await expect(panel.getByText("The diligence agent is offline.")).toHaveCount(0);
});
