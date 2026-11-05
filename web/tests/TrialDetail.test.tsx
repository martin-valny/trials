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
