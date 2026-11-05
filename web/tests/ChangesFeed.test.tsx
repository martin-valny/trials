import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ChangesFeed } from "../src/components/ChangesFeed";
import type { ChangesFile } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

const seven = readFixture<ChangesFile>("changes/7d.json");
const notable = seven.changes.filter((c) => c.notable);

const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

test("defaults to 7 days, notable only", async () => {
  const fetch = stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  expect(rows()).toHaveLength(notable.length);
  expect(notable.length).toBeGreaterThan(0);
  expect(notable.length).toBeLessThan(seven.changes.length);
  expect(screen.getByRole("tab", { name: "7 days" })).toHaveAttribute("aria-selected", "true");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("changes/7d.json"));
});

test("unchecking notable shows all", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByLabelText("Notable only"));
  expect(rows()).toHaveLength(seven.changes.length);
});

test("sponsor filter narrows rows", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  const sponsors = new Set(notable.map((c) => c.lead_sponsor));
  expect(sponsors.size).toBeGreaterThan(1);
  const [first] = [...sponsors] as string[];
  await userEvent.selectOptions(screen.getByLabelText("Sponsor"), first);
  expect(rows()).toHaveLength(notable.filter((c) => c.lead_sponsor === first).length);
});

test("field filter options come from the data", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  const options = within(screen.getByLabelText("Field")).getAllByRole("option");
  const expected = new Set(seven.changes.map((c) => c.field));
  expect(options).toHaveLength(expected.size + 1);
  await userEvent.selectOptions(screen.getByLabelText("Field"), "Overall status");
  expect(rows()).toHaveLength(1);
});

test("switching window loads that window", async () => {
  const fetch = stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("tab", { name: "30 days" }));
  await screen.findByRole("table");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("changes/30d.json"));
});

test("empty window shows message", async () => {
  stubFetch({ "changes/1d.json": { window_days: 1, generated_for: "2026-11-04", changes: [] } });
  renderAt(<ChangesFeed />);
  await userEvent.click(screen.getByRole("tab", { name: "1 day" }));
  expect(await screen.findByText("No changes in the last 1 day")).toBeInTheDocument();
});

test("missing file is treated as empty", async () => {
  stubFetch({ "changes/7d.json": 404 });
  renderAt(<ChangesFeed />);
  expect(await screen.findByText("No changes in the last 7 days")).toBeInTheDocument();
});

test("filters hiding everything explain why", async () => {
  const onlyQuiet = { ...seven, changes: seven.changes.filter((c) => !c.notable) };
  stubFetch({ "changes/7d.json": onlyQuiet });
  renderAt(<ChangesFeed />);
  expect(await screen.findByText(/No changes match these filters/)).toBeInTheDocument();
});

test("server error is shown", async () => {
  stubFetch({ "changes/7d.json": 500 });
  renderAt(<ChangesFeed />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load changes");
});

test("rows link to trial page and source", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  const nct = notable[0].nct_id;
  const row = rows().find((r) => within(r).queryByText(nct))!;
  expect(within(row).getByRole("link", { name: nct })).toHaveAttribute("href", `/trial/${nct}`);
  const source = within(row).getByRole("link", { name: /ClinicalTrials\.gov/ });
  expect(source).toHaveAttribute("href", `https://clinicaltrials.gov/study/${nct}`);
  expect(source).toHaveAttribute("rel", expect.stringContaining("noopener"));
});

test("shows old and new values and the delta", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  expect(screen.getByText("slipped 120 days")).toBeInTheDocument();
  expect(screen.getByText("Status changed")).toBeInTheDocument();
  expect(screen.getByText("RECRUITING")).toBeInTheDocument();
  expect(screen.getByText("TERMINATED")).toBeInTheDocument();
});

test("table is accessible: caption and column headers", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  const table = await screen.findByRole("table");
  expect(within(table).getByText(/Changes detected in the last 7 days/)).toBeInTheDocument();
  expect(within(table).getAllByRole("columnheader")).toHaveLength(5);
});

test("switching window resets sponsor and field filters", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  await userEvent.selectOptions(screen.getByLabelText("Sponsor"), "Acme Biotech");
  await userEvent.selectOptions(screen.getByLabelText("Field"), "Overall status");
  await userEvent.click(screen.getByRole("tab", { name: "30 days" }));
  await screen.findByRole("table");
  expect(screen.getByLabelText("Sponsor")).toHaveValue("");
  expect(screen.getByLabelText("Field")).toHaveValue("");
});

test("a removed trial has no trial page link but keeps the source link", async () => {
  const removed = seven.changes.find((c) => c.title === null);
  expect(removed).toBeDefined();
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByLabelText("Notable only")); // removed rows are never notable
  const row = rows().find((r) => within(r).queryByText(removed!.nct_id))!;
  expect(within(row).queryByRole("link", { name: removed!.nct_id })).not.toBeInTheDocument();
  expect(within(row).getByRole("link", { name: /ClinicalTrials\.gov/ })).toHaveAttribute(
    "href",
    `https://clinicaltrials.gov/study/${removed!.nct_id}`,
  );
});
