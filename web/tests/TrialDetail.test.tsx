import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";
import { TrialDetail } from "../src/components/TrialDetail";
import type { ChangeItem, TrialFile } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

const NCT = "NCT90000002";
const trial = readFixture<TrialFile>(`trials/${NCT}.json`);

const show = (nct = NCT) =>
  renderAt(
    <Routes>
      <Route path="/trial/:nct" element={<TrialDetail />} />
    </Routes>,
    `/trial/${nct}`,
  );

test("shows key facts", async () => {
  stubFetch();
  show();
  expect(await screen.findByRole("heading", { level: 1, name: trial.title })).toBeInTheDocument();
  expect(screen.getByText(trial.overall_status)).toBeInTheDocument();
  expect(screen.getByText("Example Pharma")).toBeInTheDocument();
  expect(screen.getByText("100 (estimated)")).toBeInTheDocument();
  expect(screen.getByText("Jan 2024 (actual)")).toBeInTheDocument(); // month precision
  expect(screen.getByText("29 Sep 2026 (estimated)")).toBeInTheDocument(); // day precision
  expect(screen.getByText("Dec 2026 (estimated)")).toBeInTheDocument();
  expect(screen.getByText("1 site in 1 country")).toBeInTheDocument();
});

test("timeline lists status and date changes newest first", async () => {
  const older: ChangeItem = {
    ...trial.changes[0],
    field: "overall_status",
    old_value: "NOT_YET_RECRUITING",
    new_value: "RECRUITING",
    detected_date: "2026-10-01",
    delta_days: null,
  };
  const other: ChangeItem = { ...older, field: "lead_sponsor", detected_date: "2026-10-15" };
  stubFetch({
    [`trials/${NCT}.json`]: { ...trial, changes: [...trial.changes, other, older] },
  });
  show();
  const heading = await screen.findByRole("heading", { name: "Timeline" });
  const items = within(heading.nextElementSibling as HTMLElement).getAllByRole("listitem");
  expect(items).toHaveLength(2); // sponsor change is not a timeline field
  expect(items[0]).toHaveTextContent("2026-11-04");
  expect(items[0]).toHaveTextContent("Primary completion date");
  expect(items[1]).toHaveTextContent("2026-10-01");
});

test("full change history table", async () => {
  stubFetch();
  show();
  const table = await screen.findByRole("table");
  expect(within(table).getByText(/All recorded changes \(1\)/)).toBeInTheDocument();
  expect(within(table).getByText("slipped 120 days")).toBeInTheDocument();
  expect(within(table).getByText("Date moved by 90 days or more")).toBeInTheDocument();
});

test("target placeholder is labelled", async () => {
  stubFetch();
  show();
  expect(
    await screen.findByText("Target: not yet mapped (coming in enrichment)"),
  ).toBeInTheDocument();
});

test("unknown trial shows not found", async () => {
  stubFetch();
  show("NCT00000000");
  expect(await screen.findByRole("heading", { name: "Trial not found" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Back to the changes feed/ })).toHaveAttribute(
    "href",
    "/changes",
  );
});

test("source link", async () => {
  stubFetch();
  show();
  const link = await screen.findByRole("link", { name: "View on ClinicalTrials.gov" });
  expect(link).toHaveAttribute("href", `https://clinicaltrials.gov/study/${NCT}`);
});

test("trial without changes says so", async () => {
  stubFetch({ [`trials/${NCT}.json`]: { ...trial, changes: [] } });
  show();
  expect(await screen.findByText(/No status or date changes recorded/)).toBeInTheDocument();
  expect(screen.getByText(/No changes recorded since tracking began/)).toBeInTheDocument();
});

test("load error is reported", async () => {
  stubFetch({ [`trials/${NCT}.json`]: 500 });
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load trial");
});

test("trial detail shows registry summary and eligibility", async () => {
  stubFetch({
    [`trials/${NCT}.json`]: {
      ...trial,
      brief_summary: "A plain registry summary.",
      eligibility: { sex: "ALL", min_age_years: 18, max_age_years: 55 },
    },
  });
  show();
  expect(await screen.findByRole("heading", { name: "Summary" })).toBeInTheDocument();
  expect(screen.getByText("From the registry")).toBeInTheDocument();
  expect(screen.getByText("A plain registry summary.")).toBeInTheDocument();
  expect(screen.getByText("Eligibility: All sexes, 18–55 years")).toBeInTheDocument();
});

test("eligibility omits unknown parts", async () => {
  stubFetch({
    [`trials/${NCT}.json`]: {
      ...trial,
      brief_summary: null,
      eligibility: { sex: null, min_age_years: 18, max_age_years: null },
    },
  });
  show();
  expect(await screen.findByText("Eligibility: 18 years and over")).toBeInTheDocument();
});

test("results link shown only when has_results", async () => {
  stubFetch({ [`trials/${NCT}.json`]: { ...trial, has_results: true } });
  const { unmount } = show();
  const link = await screen.findByRole("link", { name: /Results posted/ });
  expect(link).toHaveAttribute("href", `${trial.source_url}#results`);
  unmount();
  stubFetch({ [`trials/${NCT}.json`]: { ...trial, has_results: false } });
  show();
  await screen.findByRole("heading", { level: 1, name: trial.title });
  expect(screen.queryByRole("link", { name: /Results posted/ })).toBeNull();
});

test("trial page shows estimate and note", async () => {
  stubFetch();
  show();
  const sec = await screen.findByRole("region", { name: "Estimated chance of stopping early" });
  expect(sec).toHaveTextContent("Estimated chance of stopping early: 24% (24–25), typical 20% for phase 2 drug trials");
  expect(within(sec).getByRole("img", { name: "Estimated 24% (24–25); typical 20%" })).toBeInTheDocument();
  const factors = within(sec).getByRole("list", { name: "Main factors" });
  expect(factors).toHaveTextContent("Sites planned: 1");
  expect(factors).not.toHaveAttribute("aria-label");
  expect(factors).toHaveAttribute("aria-labelledby");
  expect(within(sec).getByRole("link", { name: /see Methods for accuracy/ })).toHaveAttribute("href", "/methods#stop-risk");
});

test("trial page shows Not scored reason", async () => {
  stubFetch();
  show("NCT04334031");
  expect(await screen.findByText("Not scored: phase not 1–3")).toBeInTheDocument();
  expect(screen.queryByText(/^Estimated chance of stopping early:/)).not.toBeInTheDocument();
});

test("trial page shows no estimate when per-trial estimates are off or risk.json is missing", async () => {
  const risk = readFixture<Record<string, unknown>>("risk.json");
  delete risk.trials;
  stubFetch({ "risk.json": risk });
  const a = show();
  await screen.findByRole("heading", { level: 1, name: trial.title });
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText(/stopping early/)).not.toBeInTheDocument();
  a.unmount();

  stubFetch({ "risk.json": 404 });
  show();
  await screen.findByRole("heading", { level: 1, name: trial.title });
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText(/stopping early/)).not.toBeInTheDocument();
});

test("a running trial finished in all but status shows why it is not scored", async () => {
  const risk = readFixture<{ not_scored: Record<string, string>; trials: Record<string, unknown> }>("risk.json");
  risk.not_scored.NCT04334031 = "primary completion reached";
  stubFetch({ "risk.json": risk });
  show("NCT04334031");
  expect(await screen.findByText("Not scored: primary completion reached")).toBeInTheDocument();
});
