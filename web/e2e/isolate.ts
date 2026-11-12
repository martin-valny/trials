import type { Page } from "@playwright/test";

// The e2e suite must not depend on whichever real memos sit in web/public/diligence/:
// a recorded memo for a fixture target (e.g. cd20__all.json) moves the Diligence panel to
// "a" and shifts every other panel letter. Every diligence file answers 404 (the closed
// state) unless a test routes its own fixture; routes registered later take precedence.
export async function noRecordedDiligence(page: Page) {
  await page.route("**/diligence/*.json", (r) => r.fulfill({ status: 404, body: "" }));
}
