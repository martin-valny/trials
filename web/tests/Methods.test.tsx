import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Methods } from "../src/components/Methods";
import type { ExplorerFile, ExplorerTrial, Meta } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

test("methods lists conditions from meta and limitations", async () => {
  stubFetch();
  renderAt(<Methods />);
  const meta = readFixture<Meta>("meta.json");
  for (const c of meta.conditions) expect(await screen.findByText(c)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Methods" })).toBeInTheDocument();
  expect(screen.getByText(/Registry data lags/)).toBeInTheDocument();
  expect(screen.getByText(/self-reported/)).toBeInTheDocument();
});

test("methods still renders without meta", async () => {
  stubFetch({ "meta.json": 404 });
  renderAt(<Methods />);
  expect(await screen.findByText(/condition list is unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/self-reported/)).toBeInTheDocument();
});

test("methods has map section with success definition", async () => {
  stubFetch();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const { container } = renderAt(<Methods />, "/methods#map");
  const h = await screen.findByRole("heading", { name: "How the map is made" });
  expect(h.closest("section")).toHaveAttribute("id", "map");
  expect(container.querySelector("#map")).not.toBeNull();
  expect(screen.getByText(/had no Phase 3 or 4 trial in the same disease before it started/)).toBeInTheDocument();
  expect(screen.getByText(/higher-phase trial of the same drug in the same disease/)).toBeInTheDocument();
  expect(screen.getByText(/another disease within this area is deliberately not counted/)).toBeInTheDocument();
  expect(screen.getByText(/share any of its drugs/)).toBeInTheDocument();
  expect(screen.getByText(/10,000 shuffles/)).toBeInTheDocument();
  expect(screen.getByText(/below 0\.025/)).toBeInTheDocument();
  expect(screen.getByText(/at least one drug in an experimental arm/)).toBeInTheDocument();
  expect(screen.getByText(/Phase 3-only and Phase 4 trials get no success label/)).toBeInTheDocument();
  expect(
    screen.getByText("Recently completed trials have had little time to move on, so recent years undercount success."),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/successful/i);
  expect(scroll).toHaveBeenCalled();
});

test("scrolls again after meta has loaded", async () => {
  stubFetch();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  renderAt(<Methods />, "/methods#map");
  await screen.findByText(readFixture<Meta>("meta.json").conditions[0]);
  expect(scroll.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test("methods states the mechanism source, licence, coverage, weight, counting rule and clusters", async () => {
  stubFetch();
  renderAt(<Methods />, "/methods#map");
  const text = () => document.body.textContent ?? "";
  // Cluster parameters come from explorer.json's method block.
  expect(await screen.findByText(/min_cluster_size 25/)).toBeInTheDocument();
  expect(text()).toMatch(/min_samples 10/);
  expect(screen.getByRole("link", { name: "ChEMBL" })).toHaveAttribute("href", "https://www.ebi.ac.uk/chembl/");
  expect(screen.getByRole("link", { name: "CC BY-SA 3.0" })).toBeInTheDocument();
  expect(text()).toMatch(/1,112 of 1,314 drug-bearing trials \(84\.6%\)/);
  expect(text()).toMatch(/201 mechanism classes/);
  expect(text()).toMatch(/Targeted drugs: 1,062 trials/);
  expect(text()).toMatch(/Not yet categorised: 570\./);
  expect(text()).toMatch(/not yet sorted \(449, of which 13 have no experimental treatment listed\)/);
  expect(text()).toMatch(/weight 1\.0/);
  expect(screen.getByRole("link", { name: /weight research note/ })).toHaveAttribute(
    "href",
    expect.stringContaining("docs/superpowers/research/2026-11-06-mechanism-weight.md"),
  );
  expect(text()).toMatch(/counts in each group it touches/);
  expect(text()).toMatch(/HDBSCAN/);
  expect(text()).toMatch(/at least 25% of all its members/);
  expect(text()).toMatch(/What is not mapped/);
  // Five feature groups now, mechanism among them.
  expect(text()).toMatch(/Five groups of features/);
});

test("methods: the statistic leaves out mechanism; no percentage under 10; cluster anchors and thresholds", async () => {
  stubFetch();
  renderAt(<Methods />, "/methods#map");
  await screen.findByText(/min_cluster_size 25/);
  const text = document.body.textContent ?? "";
  expect(text).toMatch(/disease, treatment type, molecule and population only/);
  expect(text).toMatch(/By mechanism view/);
  expect(text).toMatch(/lift of 1\.32 \(shuffled labels 0\.62–1\.41,\s+p = 0\.061\)/);
  expect(text).toMatch(/would give 0\.71 \(p = 0\.94\)/);
  expect(text).toMatch(/shows no\s+percentage, only an outline bar, the counts/);
  expect(text).toMatch(/member nearest the cluster's median position/);
  // Thresholds come from explorer.json method.clusters.
  expect(text).toMatch(/at least 60% of the members/);
  expect(text).toMatch(/at least 15% of the members/);
});

test("Methods describes treatments without a molecular target", async () => {
  stubFetch();
  renderAt(<Methods />, "/methods#map");
  const h = await screen.findByRole("heading", { name: "Treatments without a molecular target" });
  expect(h).toBeInTheDocument();
  const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
  expect(text).toMatch(/Open Targets/);
  expect(text).toMatch(/ChEMBL/);
  expect(text).toMatch(/no target/i);
  expect(text).toMatch(/MeSH/);
  expect(text).toMatch(/E02/);
  for (const label of [
    "Targeted drugs",
    "Cell & transplant",
    "Antibody & plasma",
    "Tolerisation",
    "Broad immunomodulators",
    "Non-drug care",
    "Not yet categorised",
  ])
    expect(text).toContain(label);
  expect(text).toMatch(/counted for the drug that advanced/);
  expect(text).toMatch(/Thought to work by:/);
  // Coverage restated as two numbers.
  expect(text).toMatch(/1,121 of 1,314 drug-bearing trials \(85\.3%\)/);
  expect(text).toMatch(/2,156 of 2,987 trials \(72\.2%\)/);
  expect(text).toMatch(/Sorensen/);
});

test("Methods lists the not-yet-categorised names with counts, grouped, and links each group to the map", async () => {
  const f = readFixture<ExplorerFile>("explorer.json");
  const mk = (i: number, extra: Partial<ExplorerTrial>): ExplorerTrial => ({
    ...f.trials[0]!,
    nct_id: `NCT7000000${i}`,
    approaches: ["unclassified"],
    kinds: [],
    unsorted: [],
    ...extra,
  });
  const names = Array.from({ length: 12 }, (_, i) => `mystery drug ${i}`);
  const trials = [...f.trials, ...names.map((n, i) => mk(i, { unsorted: [n] })), mk(20, { unsorted: ["mystery drug 0"] }), mk(21, {})];
  stubFetch({ "explorer.json": { ...f, trials } });
  renderAt(<Methods />, "/methods#not-yet-categorised");
  const group = await screen.findByRole("region", { name: "Not yet sorted" });
  const rows = within(group).getAllByRole("listitem");
  expect(rows).toHaveLength(10);
  expect(rows[0]).toHaveTextContent("mystery drug 0 2 trials");
  await userEvent.click(within(group).getByRole("button", { name: /^Show all \d+$/ }));
  expect(within(group).getAllByRole("listitem").length).toBeGreaterThanOrEqual(12);
  expect(within(group).getByRole("link", { name: "Show these trials on the map" }).getAttribute("href")).toMatch(
    /^\/explore\?nct=NCT70000000/,
  );
  expect(screen.getByRole("region", { name: "No experimental treatment listed" })).toBeInTheDocument();
});

test("Methods has the six sections with their ids", async () => {
  stubFetch({
    "pipeline.json": {
      ...readFixture<Record<string, unknown>>("pipeline.json"),
      unrowed: [
        { class: "Symptomatic agent", trials: 12, reason: "symptomatic, not a disease target" },
        { class: "DNA inhibitor", trials: 5, reason: "conditioning chemotherapy" },
      ],
    },
  });
  const { container } = renderAt(<Methods />, "/methods");
  await screen.findByRole("heading", { name: "Advanced to next phase, and its time bias" });
  for (const id of ["advanced", "registry-only", "rows-and-companies", "unrowed", "not-yet-categorised", "map-statistic"])
    expect(container.querySelector(`#${id}`), id).not.toBeNull();

  const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
  expect(within(container.querySelector("#advanced")! as HTMLElement).getByText(/can't have advanced yet/)).toBeInTheDocument();
  expect(within(container.querySelector("#registry-only")! as HTMLElement).getByText(/registered/)).toBeInTheDocument();
  const rows = container.querySelector("#rows-and-companies") as HTMLElement;
  for (const path of ["config/pipeline/rows.csv", "config/pipeline/background.csv", "config/sponsors/parents.csv"])
    expect(rows.textContent).toContain(path);
  expect(rows.textContent).toContain("NCT00168766");
  expect(rows.textContent).toContain("NCT00771043");
  expect(rows.textContent).toMatch(/comparator/);
  const un = await within(container.querySelector("#unrowed") as HTMLElement).findByText(/Symptomatic agent/);
  expect(un.closest("li")?.textContent).toMatch(/12 trials/);
  expect(text).toMatch(/not shown as a row/);
  const stat = container.querySelector("#map-statistic") as HTMLElement;
  expect(stat.textContent).toMatch(/p-value/);
  expect(stat.textContent).toMatch(/10,000 shuffles/);
});
