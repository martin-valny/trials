import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { TrialsList } from "../src/components/TrialsList";
import type { TrialsIndex } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

const index = readFixture<TrialsIndex>("trials.json");
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

test("lists every tracked trial with a count", async () => {
  stubFetch();
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  expect(rows()).toHaveLength(index.trials.length);
  expect(
    screen.getByText(`Showing ${index.trials.length} of ${index.trials.length} tracked trials`),
  ).toBeInTheDocument();
});

test("most recently changed trials come first, then by NCT number", async () => {
  stubFetch();
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  const expected = [...index.trials]
    .sort(
      (a, b) =>
        (b.last_change ?? "").localeCompare(a.last_change ?? "") ||
        a.nct_id.localeCompare(b.nct_id),
    )
    .map((t) => t.nct_id);
  const shown = rows().map((r) => within(r).getAllByRole("link")[0].textContent);
  expect(shown).toEqual(expected);
  expect(index.trials.some((t) => t.last_change !== null)).toBe(true);
});

test("rows link to the trial page", async () => {
  stubFetch();
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  const nct = index.trials[0].nct_id;
  expect(screen.getByRole("link", { name: nct })).toHaveAttribute("href", `/trial/${nct}`);
});

test("search matches NCT number, title and sponsor, case-insensitively", async () => {
  stubFetch();
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  const box = screen.getByLabelText("Search");
  await userEvent.type(box, "acme biotech");
  const sponsor = index.trials.filter((t) => t.lead_sponsor === "Acme Biotech");
  expect(sponsor.length).toBeGreaterThan(0);
  expect(rows()).toHaveLength(sponsor.length);
  await userEvent.clear(box);
  await userEvent.type(box, index.trials[1].nct_id.toLowerCase());
  expect(rows()).toHaveLength(1);
});

test("status filter narrows rows and nothing-matching is explained", async () => {
  stubFetch();
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  await userEvent.selectOptions(screen.getByLabelText("Status"), "TERMINATED");
  expect(rows()).toHaveLength(index.trials.filter((t) => t.overall_status === "TERMINATED").length);
  await userEvent.type(screen.getByLabelText("Search"), "zzzz-no-such-trial");
  expect(screen.getByText("No trials match these filters.")).toBeInTheDocument();
});

test("no trials tracked yet", async () => {
  stubFetch({ "trials.json": { generated_for: "2026-11-05", trials: [] } });
  renderAt(<TrialsList />);
  expect(await screen.findByText("No trials are tracked yet.")).toBeInTheDocument();
});

test("missing file is treated as empty and errors are reported", async () => {
  stubFetch({ "trials.json": 404 });
  renderAt(<TrialsList />);
  expect(await screen.findByText("No trials are tracked yet.")).toBeInTheDocument();
});

test("server error is shown", async () => {
  stubFetch({ "trials.json": 500 });
  renderAt(<TrialsList />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load trials");
});
