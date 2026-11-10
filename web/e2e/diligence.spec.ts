import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// The synthetic run lives only in the test fixtures (R6: nothing fake ships in web/public/diligence/),
// so the recorded-run path is served by route interception. The build has no agent URL: this is the offline path.
const RUN = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "tests", "fixtures", "diligence", "cd20__MS.json"), "utf-8");
const LABEL = "AI judgement from public data, not investment advice";
const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

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
