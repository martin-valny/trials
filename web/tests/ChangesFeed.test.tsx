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
  const group = screen.getByRole("group", { name: "Time window" });
  expect(within(group).getAllByRole("button")).toHaveLength(3);
  expect(within(group).getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  expect(within(group).getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "false");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("changes/7d.json"));
});

test("unchecking notable shows all", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  const toggle = screen.getByRole("button", { name: "Notable only" });
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(rows()).toHaveLength(seven.changes.length);
});

test("sponsor filter narrows rows", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  const sponsors = new Set(notable.map((c) => c.lead_sponsor));
  expect(sponsors.size).toBeGreaterThan(1);
  const [first] = [...sponsors] as string[];
  await userEvent.click(screen.getByRole("button", { name: "Sponsor: all" }));
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  await userEvent.click(screen.getByRole("checkbox", { name: new RegExp(`^${first}`) }));
  expect(rows()).toHaveLength(notable.filter((c) => c.lead_sponsor === first).length);
});

test("field filter options come from the data", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "Field: all" }));
  const options = within(screen.getByRole("group", { name: "Field" })).getAllByRole("checkbox");
  const expected = new Set(seven.changes.map((c) => c.field));
  expect(options).toHaveLength(expected.size);
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /^Overall status/ }));
  expect(rows()).toHaveLength(1);
});

test("switching window loads that window", async () => {
  const fetch = stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "30 days" }));
  await screen.findByRole("table");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("changes/30d.json"));
});

test("empty window shows message", async () => {
  stubFetch({ "changes/1d.json": { window_days: 1, generated_for: "2026-11-04", changes: [] } });
  renderAt(<ChangesFeed />);
  await userEvent.click(screen.getByRole("button", { name: "1 day" }));
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
  expect(screen.getByText("Recruiting")).toBeInTheDocument();
  expect(screen.getByText("Terminated")).toBeInTheDocument();
  expect(screen.queryByText("RECRUITING")).not.toBeInTheDocument();
  expect(screen.getAllByText(/Detected 4 Nov 2026/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/2026-11-04/)).not.toBeInTheDocument();
});

test("the head states the counts for the window in view", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  expect(screen.getByRole("heading", { level: 1, name: "Changes" })).toBeInTheDocument();
  expect(
    screen.getByText(`${seven.changes.length} changes to tracked trials in the last 7 days; ${notable.length} notable.`),
  ).toBeInTheDocument();
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
  await userEvent.click(screen.getByRole("button", { name: "Sponsor: all" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /^Acme Biotech/ }));
  expect(screen.getByRole("button", { name: /^Sponsor: \d of \d$/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "30 days" }));
  await screen.findByRole("table");
  expect(screen.getByRole("button", { name: "Sponsor: all" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Field: all" })).toBeInTheDocument();
});

test("a removed trial has no trial page link but keeps the source link", async () => {
  const removed = seven.changes.find((c) => c.title === null);
  expect(removed).toBeDefined();
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "Notable only" })); // removed rows are never notable
  const row = rows().find((r) => within(r).queryByText(removed!.nct_id))!;
  expect(within(row).queryByRole("link", { name: removed!.nct_id })).not.toBeInTheDocument();
  expect(within(row).getByRole("link", { name: /ClinicalTrials\.gov/ })).toHaveAttribute(
    "href",
    `https://clinicaltrials.gov/study/${removed!.nct_id}`,
  );
});

test("an empty feed explains itself and links to the trials list", async () => {
  stubFetch({ "changes/7d.json": { window_days: 7, generated_for: "2026-11-04", changes: [] } });
  renderAt(<ChangesFeed />);
  expect(await screen.findByText("No changes in the last 7 days")).toBeInTheDocument();
  expect(await screen.findByText(/Tracking 14 trials since 2026-11-03/)).toBeInTheDocument();
  expect(screen.getByText(/a new deployment starts empty/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Browse the tracked trials" })).toHaveAttribute(
    "href",
    "/trials",
  );
});

test("an empty feed still renders without metadata", async () => {
  stubFetch({
    "changes/7d.json": { window_days: 7, generated_for: "2026-11-04", changes: [] },
    "meta.json": 404,
  });
  renderAt(<ChangesFeed />);
  expect(await screen.findByText("No changes in the last 7 days")).toBeInTheDocument();
  expect(screen.queryByText(/Tracking/)).not.toBeInTheDocument();
});

test("every row keeps a source link, removed trials included, with no phone-only hiding class", async () => {
  stubFetch();
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "Notable only" }));
  for (const row of rows()) {
    const src = within(row).getByRole("link", { name: /ClinicalTrials\.gov record for NCT\d+/ });
    expect(src.closest("td")).not.toHaveClass("ch-why-none");
    expect(src.closest("td")?.className).not.toMatch(/hide|mobile|phone/);
  }
});

test("registry codes read as words: phases and enrollment type", async () => {
  const mk = (field: string, o: unknown, n: unknown) => ({
    ...seven.changes[0], nct_id: "NCT00000001", field, old_value: o, new_value: n, notable: true,
  });
  stubFetch({
    "changes/7d.json": {
      ...seven,
      changes: [
        mk("phases", ["PHASE2"], ["PHASE1", "PHASE2"]),
        mk("phase", "EARLY_PHASE1", "PHASE3"),
        mk("enrollment_type", "ESTIMATED", "ACTUAL"),
      ],
    },
  });
  renderAt(<ChangesFeed />);
  await screen.findByRole("table");
  for (const t of ["Phase 2", "Phase 1/2", "Early phase 1", "Phase 3", "Estimated", "Actual"])
    expect(screen.getByText(t)).toBeInTheDocument();
  expect(screen.queryByText(/PHASE|ESTIMATED|ACTUAL/)).not.toBeInTheDocument();
});
