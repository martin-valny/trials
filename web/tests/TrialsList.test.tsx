import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { TrialsList } from "../src/components/TrialsList";
import type { TrialsIndex } from "../src/types";
import { render } from "@testing-library/react";
import { MemoryRouter, useLocation, useSearchParams } from "react-router-dom";
import { readFixture, renderAt, stubFetch } from "./helpers";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
const renderWithWhere = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <TrialsList />
      <Where />
    </MemoryRouter>,
  );

function ScopeSwap({ n }: { n: string }) {
  const [, setParams] = useSearchParams();
  return (
    <button type="button" onClick={() => setParams({ nct: n })}>
      swap scope
    </button>
  );
}

const index = readFixture<TrialsIndex>("trials.json");
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

test("lists every tracked trial with a count", async () => {
  stubFetch();
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  expect(rows()).toHaveLength(index.trials.length);
  expect(
    screen.getByText(`Showing ${index.trials.length} of ${index.trials.length} trials`),
  ).toBeInTheDocument();
  expect(
    screen.getByText(`${index.trials.length} tracked trials, most recently changed first.`),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Trials" })).toBeInTheDocument();
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
  await userEvent.click(screen.getByRole("button", { name: "Status: all" }));
  const boxes = within(screen.getByRole("group", { name: "Status" })).getAllByRole("checkbox");
  for (const b of boxes) if (!/^Terminated/.test(b.getAttribute("aria-label") ?? b.closest("label")?.textContent ?? "")) await userEvent.click(b);
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

const ids = () => rows().map((r) => within(r).getAllByRole("link")[0].textContent);

test("?nct= narrows the list; unknown and duplicate ids are ignored and the count is right", async () => {
  stubFetch();
  const [a, b] = index.trials;
  renderWithWhere(`/trials?nct=${a.nct_id},${a.nct_id},NCT00000000,${b.nct_id}&from=CD20`);
  await screen.findByRole("table");
  expect(ids().sort()).toEqual([a.nct_id, b.nct_id].sort());
  const banner = screen.getByRole("status");
  expect(banner).toHaveTextContent("Showing 2 trials from CD20");
});

test("Clear removes the nct, from and disease params and shows every trial", async () => {
  stubFetch();
  renderWithWhere(`/trials?nct=${index.trials[0].nct_id}&from=CD20&disease=MS`);
  await screen.findByRole("table");
  expect(rows()).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Showing 1 trial from CD20 in Multiple sclerosis");
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(rows()).toHaveLength(index.trials.length);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByTestId("where").textContent).toBe("/trials");
});

test("a list with no known trials says so", async () => {
  stubFetch();
  renderWithWhere("/trials?nct=NCT00000000&from=X");
  expect(await screen.findByText("None of these trials are in the current data.")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Showing 0 trials from X");
});

// Two trials in MG, one of them also in MS, the rest in MS only.
const withDz = () => {
  const [a, b] = index.trials;
  const trials = index.trials.map((t) =>
    t === a ? { ...t, dz: ["MS", "MG"] } : t === b ? { ...t, dz: ["MG"] } : { ...t, dz: ["MS"] },
  );
  return { a, b, trials, stub: () => stubFetch({ "trials.json": { ...index, trials } }) };
};

test("?disease= alone keeps the trials in that disease and names it in the banner", async () => {
  const { a, b, stub } = withDz();
  stub();
  renderWithWhere("/trials?disease=MG");
  await screen.findByRole("table");
  expect(ids().sort()).toEqual([a.nct_id, b.nct_id].sort());
  expect(screen.getByRole("status")).toHaveTextContent(/^Showing 2 trials in Myasthenia gravis · Clear$/);
});

test("?disease= combines with ?nct=", async () => {
  const { a, b, stub } = withDz();
  stub();
  renderWithWhere(`/trials?nct=${a.nct_id},${b.nct_id},${index.trials[2].nct_id}&from=CD20&disease=MS`);
  await screen.findByRole("table");
  expect(ids().sort()).toEqual([a.nct_id, index.trials[2].nct_id].sort());
  expect(screen.getByRole("status")).toHaveTextContent("Showing 2 trials from CD20 in Multiple sclerosis");
});

test("?disease= with no trials says so; Clear shows every trial", async () => {
  stubFetch();
  renderWithWhere("/trials?disease=MG");
  expect(await screen.findByText("No trials match these filters.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(rows()).toHaveLength(index.trials.length);
  expect(screen.getByTestId("where").textContent).toBe("/trials");
});

test("an unknown disease code filters nothing and the banner leaves out the disease", async () => {
  stubFetch();
  renderWithWhere(`/trials?nct=${index.trials[0].nct_id}&from=CD20&disease=ZZZ`);
  await screen.findByRole("table");
  expect(rows()).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent(/^Showing 1 trial from CD20 · Clear$/);
});

test("an unknown disease code on its own shows every trial and no banner", async () => {
  stubFetch();
  renderWithWhere("/trials?disease=ZZZ");
  await screen.findByRole("table");
  expect(rows()).toHaveLength(index.trials.length);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("if pipeline.json cannot be loaded the disease filter is skipped", async () => {
  stubFetch({ "pipeline.json": 500 });
  renderWithWhere("/trials?disease=MS");
  await screen.findByRole("table");
  expect(rows()).toHaveLength(index.trials.length);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

// A list longer than one page: the fixture's 14 trials repeated under new NCT numbers.
const many = (n: number) => {
  const trials = Array.from({ length: n }, (_, i) => {
    const t = index.trials[i % index.trials.length];
    return { ...t, nct_id: `NCT${String(90000000 + i)}`, last_change: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}` };
  });
  return { ...index, trials };
};

test("pages 50 at a time with Show more", async () => {
  stubFetch({ "trials.json": many(120) });
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  expect(rows()).toHaveLength(50);
  expect(screen.getByText("Showing 50 of 120 trials")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^Show 50 more/ }));
  expect(rows()).toHaveLength(100);
  await userEvent.click(screen.getByRole("button", { name: /^Show 20 more/ }));
  expect(rows()).toHaveLength(120);
  expect(screen.queryByRole("button", { name: /Show \d+ more/ })).not.toBeInTheDocument();
});

test("search covers trials beyond the first page", async () => {
  stubFetch({ "trials.json": many(120) });
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  expect(ids()).not.toContain("NCT90000119");
  await userEvent.type(screen.getByLabelText("Search"), "NCT90000119");
  expect(ids()).toEqual(["NCT90000119"]);
});

test("changing the query or the status filter returns to 50 rows", async () => {
  // 240 trials: every one RECRUITING except the last 30 COMPLETED, so the remaining set after a status pick is > 100.
  const base = many(240);
  const trials = base.trials.map((t, i) => ({ ...t, overall_status: i < 210 ? "RECRUITING" : "COMPLETED" }));
  stubFetch({ "trials.json": { ...base, trials } });
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: /^Show 50 more/ }));
  expect(rows()).toHaveLength(100);
  await userEvent.type(screen.getByLabelText("Search"), "NCT9000");
  expect(rows()).toHaveLength(50);
  await userEvent.click(screen.getByRole("button", { name: /^Show 50 more/ }));
  expect(rows()).toHaveLength(100);
  await userEvent.clear(screen.getByLabelText("Search"));
  expect(rows()).toHaveLength(50);
  await userEvent.click(screen.getByRole("button", { name: /^Show 50 more/ }));
  expect(rows()).toHaveLength(100);
  await userEvent.click(screen.getByRole("button", { name: "Status: all" }));
  const group = within(screen.getByRole("group", { name: "Status" }));
  await userEvent.click(group.getAllByRole("checkbox").find((c) => /^Completed/.test(c.getAttribute("aria-label") ?? c.closest("label")?.textContent ?? ""))!);
  expect(screen.getByText("Showing 50 of 210 trials")).toBeInTheDocument();
  expect(rows()).toHaveLength(50);
});

test("changing the ?nct= scope returns to 50 rows", async () => {
  stubFetch({ "trials.json": many(240) });
  render(
    <MemoryRouter initialEntries={["/trials?nct=" + many(240).trials.slice(0, 150).map((t) => t.nct_id).join(",")]}>
      <TrialsList />
      <ScopeSwap n={many(240).trials.slice(0, 120).map((t) => t.nct_id).join(",")} />
    </MemoryRouter>,
  );
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: /^Show 50 more/ }));
  expect(rows()).toHaveLength(100);
  await userEvent.click(screen.getByRole("button", { name: "swap scope" }));
  expect(screen.getByText("Showing 50 of 120 trials")).toBeInTheDocument();
  expect(rows()).toHaveLength(50);
});

test("status reads as words with a mark, phases and dates as people write them", async () => {
  stubFetch({
    "trials.json": {
      ...index,
      trials: [
        { ...index.trials[0], overall_status: "ACTIVE_NOT_RECRUITING", phases: ["PHASE2", "PHASE3"], last_change: "2026-11-06" },
      ],
    },
  });
  renderAt(<TrialsList />);
  await screen.findByRole("table");
  const row = rows()[0];
  expect(within(row).getByText("Active, not recruiting")).toBeInTheDocument();
  expect(row.querySelector(".tr-mark.run")).not.toBeNull();
  expect(within(row).getByText("Phase 2/3")).toBeInTheDocument();
  expect(within(row).getByText("6 Nov 2026")).toBeInTheDocument();
});
