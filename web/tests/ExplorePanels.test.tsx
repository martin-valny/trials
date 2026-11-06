import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { Explore } from "../src/components/explore/Explore";
import { liftSentence } from "../src/lib/explorer";
import type { ExplorerFile, TrialFile } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

const loadTrial = vi.hoisted(() => vi.fn());
vi.mock("../src/data", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/data")>();
  loadTrial.mockImplementation(real.loadTrial);
  return { ...real, loadTrial };
});

const explorer = readFixture<ExplorerFile>("explorer.json");
const N = explorer.trials.length;

function fakeContext(): CanvasRenderingContext2D {
  const noop = () => undefined;
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => (key === "canvas" ? undefined : key === "measureText" ? () => ({ width: 0 }) : noop),
    set: () => true,
  });
}

beforeEach(() => {
  loadTrial.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => fakeContext()) as unknown as HTMLCanvasElement["getContext"],
  );
  stubFetch();
});

const ready = async () => {
  renderAt(<Explore />, "/explore");
  return screen.findByLabelText("Find a trial");
};

test("success panel shows lift sentence and definition link", async () => {
  await ready();
  const b = screen.getByRole("region", { name: /Share that succeeded, of finished trials that could succeed/ });
  expect(within(b).getByText(liftSentence(explorer.stats))).toBeInTheDocument();
  expect(within(b).getByText(/Succeeded = drug moved to a later phase\./)).toBeInTheDocument();
  expect(within(b).getByRole("link", { name: "How this is measured" })).toHaveAttribute(
    "href",
    "#/methods#map",
  );
  // One bar per by_condition row, labelled with its text.
  for (const row of explorer.stats.by_condition) {
    expect(within(b).getByText(row.label)).toBeInTheDocument();
  }
  expect(
    within(b).getByText(/^Tick: average across all finished trials that could succeed \(\d+%\)\.$/),
  ).toBeInTheDocument();
  expect(
    within(b).getByText("Finished Early Phase 1–Phase 2/3 trials with an experimental drug."),
  ).toBeInTheDocument();
  const c = screen.getByRole("region", { name: /Trials by phase/ });
  expect(within(c).getByText("Phase 2")).toBeInTheDocument();
});

test("unchecking a disease in its dropdown updates the visible count", async () => {
  await ready();
  expect(screen.getByText(`Showing ${N} of ${N} trials`)).toBeInTheDocument();
  const label = explorer.stats.by_condition[0].label;
  const withLabel = explorer.trials.filter((t) => t.condition_labels.includes(label)).length;
  const others = explorer.trials.filter(
    (t) => t.condition_labels.includes(label) && t.condition_labels.every((l) => l === label),
  ).length;
  await userEvent.click(screen.getByRole("button", { name: "Disease: all" }));
  const box = screen.getByRole("checkbox", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ${withLabel}$`) });
  expect(box).toBeChecked();
  await userEvent.click(box);
  expect(box).not.toBeChecked();
  expect(screen.getByText(`Showing ${N - others} of ${N} trials`)).toBeInTheDocument();
  await userEvent.click(box);
  expect(screen.getByText(`Showing ${N} of ${N} trials`)).toBeInTheDocument();
});

test("colour toggle is a pressed-button group", async () => {
  await ready();
  const outcome = screen.getByRole("button", { name: "Outcome" });
  const phase = screen.getByRole("button", { name: "Phase" });
  expect(outcome).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(phase);
  expect(phase).toHaveAttribute("aria-pressed", "true");
  expect(outcome).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("link", { name: "View as list" })).toHaveAttribute("href", "#/trials");
});

test("search narrows to matching drug", async () => {
  const box = await ready();
  const drug = explorer.trials.find((t) => t.drugs.length > 0 && t.nct_id === "NCT02343159")!.drugs[0];
  const hits = explorer.trials.filter((t) => t.drugs.includes(drug)).length;
  await userEvent.type(box, drug);
  expect(screen.getByText(`Showing ${hits} of ${N} trials`)).toBeInTheDocument();
});

test("selecting a trial loads its summary", async () => {
  const doc = readFixture<TrialFile>("trials/NCT02343159.json");
  loadTrial.mockResolvedValueOnce({
    ...doc,
    brief_summary: "First sentence here. Second one follows? Third should not show.",
  });
  const box = await ready();
  await userEvent.type(box, "NCT02343159{Enter}");
  expect(loadTrial).toHaveBeenCalledWith("NCT02343159");
  const d = screen.getByRole("region", { name: "Selected trial" });
  expect(d).toHaveAttribute("aria-live", "polite");
  expect(await within(d).findByText("First sentence here. Second one follows?")).toBeInTheDocument();
  expect(within(d).getByText("From the registry")).toBeInTheDocument();
  expect(within(d).queryByText(/Third should not show/)).not.toBeInTheDocument();
  expect(within(d).getByText(/Phase 4/)).toBeInTheDocument();
  expect(within(d).getByText(/Stopped early/)).toBeInTheDocument();
  expect(within(d).getByText(/dimethyl fumarate/)).toBeInTheDocument();
  expect(within(d).getByText(/84 enrolled/)).toBeInTheDocument();
  expect(within(d).getByRole("link", { name: "Trial page" })).toHaveAttribute("href", "#/trial/NCT02343159");
  expect(within(d).getByRole("link", { name: /ClinicalTrials\.gov/ })).toHaveAttribute(
    "href",
    "https://clinicaltrials.gov/study/NCT02343159",
  );
});

test("the colour key names each outcome in words and is not a control", async () => {
  await ready();
  const key = screen.getByRole("list", { name: "Colour key: Outcome" });
  const labels = [
    "Succeeded (drug moved to a later phase)",
    "Stopped early",
    "Completed, outcome unknown",
    "Still running",
    "Status unknown",
  ];
  const present = labels.filter((_, i) =>
    explorer.trials.some((t) => t.outcome === ["succeeded", "stopped", "completed_unknown", "running", "unknown"][i]),
  );
  expect(within(key).getAllByRole("listitem").map((li) => li.textContent)).toEqual(present);
  expect(within(key).queryByRole("button")).not.toBeInTheDocument();
  // Filtering an outcome happens in the toolbar's Outcome dropdown.
  const running = explorer.trials.filter((t) => t.outcome === "running").length;
  await userEvent.click(screen.getByRole("button", { name: "Outcome: all" }));
  await userEvent.click(screen.getByRole("checkbox", { name: `Still running ${running}` }));
  expect(screen.getByText(`Showing ${N - running} of ${N} trials`)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Outcome: 4 of 5" })).toBeInTheDocument();
});

test("the colour key follows the colour mode", async () => {
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "Phase" }));
  const key = screen.getByRole("list", { name: "Colour key: Phase" });
  expect(within(key).getByText("Phase 2")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Disease" }));
  const first = explorer.trials[0].condition_labels[0];
  expect(within(screen.getByRole("list", { name: "Colour key: Disease" })).getByText(first)).toBeInTheDocument();
});

test("enter with an empty query selects nothing", async () => {
  const box = await ready();
  await userEvent.type(box, "{Enter}");
  const d = screen.getByRole("region", { name: "Selected trial" });
  expect(within(d).getByText(/Click a dot in/)).toBeInTheDocument();
  expect(loadTrial).not.toHaveBeenCalled();
});

test("panel b shows succeeded/finished per row and outlines rows with fewer than 10 finished", async () => {
  await ready();
  const b = screen.getByRole("region", { name: /Share that succeeded, of finished trials that could succeed/ });
  const rows = within(b).getAllByRole("listitem");
  expect(rows).toHaveLength(explorer.stats.by_condition.length);
  explorer.stats.by_condition.forEach((row, i) => {
    expect(within(rows[i]).getByText(`${row.succeeded}/${row.finished}`)).toBeInTheDocument();
    expect(rows[i].classList.contains("few")).toBe(row.finished < 10);
  });
  expect(within(b).getByText(/Outlined: fewer than 10 finished trials\./)).toBeInTheDocument();
});

test("panel c scales to the largest phased column and moves trials without a phase to the note", async () => {
  await ready();
  const c = screen.getByRole("region", { name: /Trials by phase/ });
  const na = explorer.trials.filter((t) => t.phase === null || t.phase === "NA").length;
  expect(na).toBeGreaterThan(0);
  expect(within(c).queryByText("Not applicable")).not.toBeInTheDocument();
  expect(within(c).getByText(`+${na} trials without a phase, outside this measure.`)).toBeInTheDocument();
  // The largest phased column fills the panel height.
  const heights = [...c.querySelectorAll<HTMLElement>(".flow-col")].map((col) =>
    [...col.querySelectorAll<HTMLElement>("i")].reduce((a, i) => a + parseFloat(i.style.height), 0),
  );
  expect(Math.max(...heights)).toBeCloseTo(100);
  // The heading names the accent with a swatch, not the word "red".
  const h = within(c).getByRole("heading");
  expect(h.textContent).not.toMatch(/red/);
  expect(h.querySelector(".swatch-inline")).not.toBeNull();
});

test("the colour key is a line under panel a's heading, before the map; panel d sits under the plate", async () => {
  await ready();
  const a = screen.getByRole("region", { name: /Embedding of/ });
  const key = within(a).getByRole("list", { name: /^Colour key/ });
  const canvas = screen.getByRole("img", { name: /^3D map/ });
  const d = screen.getByRole("region", { name: "Selected trial" });
  const follows = (x: Node, y: Node) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(follows(within(a).getByRole("heading"), key)).toBe(true);
  expect(follows(key, canvas)).toBe(true);
  expect(follows(canvas, d)).toBe(true);
  expect(a.contains(d)).toBe(false);
});

test("unknown outcome swatch is a ring, not a filled dot, in the key and in the Outcome dropdown", async () => {
  await ready();
  const key = screen.getByRole("list", { name: "Colour key: Outcome" });
  expect(within(key).getByText("Status unknown").querySelector(".swatch.ring")).not.toBeNull();
  expect(within(key).getByText("Still running").querySelector(".swatch.ring")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Outcome: all" }));
  const n = explorer.trials.filter((t) => t.outcome === "unknown").length;
  const row = screen.getByRole("checkbox", { name: `Status unknown ${n}` }).closest("label")!;
  expect(row.querySelector(".swatch.ring")).not.toBeNull();
});

const withStats = (o: Partial<ExplorerFile["stats"]>): ExplorerFile => ({
  ...explorer,
  stats: {
    ...explorer.stats,
    verdict: "chance",
    lift: 1.31,
    baseline_mean: 0.99,
    baseline_range: [0.64, 1.39],
    p_value: 0.058,
    n_averaged: 66,
    n_short: 0,
    ...o,
  },
});

test("panel b says how many successes the statistic rests on, and how many were short of neighbours", async () => {
  stubFetch({ "explorer.json": withStats({ n_averaged: 40, n_short: 3 }) });
  await ready();
  const b = screen.getByRole("region", { name: /Share that succeeded/ });
  expect(
    within(b).getByText("Based on 40 trials that succeeded; 3 had fewer than 10 usable neighbours."),
  ).toBeInTheDocument();
  expect(within(b).getByText("Trials that succeeded cluster no more than chance would (p = 0.058).")).toBeInTheDocument();
});

test("panel b omits the short-neighbour clause when none were short", async () => {
  stubFetch({ "explorer.json": withStats({ n_averaged: 66, n_short: 0 }) });
  await ready();
  const b = screen.getByRole("region", { name: /Share that succeeded/ });
  expect(within(b).getByText("Based on 66 trials that succeeded.")).toBeInTheDocument();
});

test("panel b has no basis note when the statistic was not computed", async () => {
  await ready();
  const b = screen.getByRole("region", { name: /Share that succeeded/ });
  expect(within(b).queryByText(/^Based on/)).not.toBeInTheDocument();
});

test("panel c note is a plain count of shown trials that succeeded", async () => {
  await ready();
  const c = screen.getByRole("region", { name: /Trials by phase/ });
  const won = explorer.trials.filter((t) => t.outcome === "succeeded").length;
  expect(within(c).getByText(`${won} shown trials succeeded.`)).toBeInTheDocument();
  expect(within(c).queryByText(/ of .* shown trials/)).not.toBeInTheDocument();
});

test("results posted is a narrowing pill in the toolbar with its count, off by default, and narrows when on", async () => {
  await ready();
  const bar = screen.getByRole("group", { name: "Map controls" });
  const withResults = explorer.trials.filter((t) => t.has_results).length;
  expect(withResults).toBeGreaterThan(0);
  const pill = within(bar).getByRole("button", { name: `Results posted ${withResults}` });
  expect(pill).toHaveClass("pill", "narrowing");
  expect(pill).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText(`Showing ${N} of ${N} trials`)).toBeInTheDocument();
  await userEvent.click(pill);
  expect(pill).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(`Showing ${withResults} of ${N} trials`)).toBeInTheDocument();
  await userEvent.click(pill);
  expect(screen.getByText(`Showing ${N} of ${N} trials`)).toBeInTheDocument();
});

test("a dropdown is quiet at rest and marked as narrowed once it narrows", async () => {
  await ready();
  const phase = screen.getByRole("button", { name: "Phase: all" });
  expect(phase).toHaveAttribute("data-narrowed", "false");
  await userEvent.click(phase);
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  const narrowed = screen.getByRole("button", { name: "Phase: none" });
  expect(narrowed).toHaveAttribute("data-narrowed", "true");
  expect(narrowed.querySelector(".dropdown-value")).toHaveTextContent("none");
  expect(screen.getByRole("button", { name: "Years: all" })).toHaveAttribute("data-narrowed", "false");
});

test("on narrow screens a selected trial gets a short sticky line with a Details link", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const box = await ready();
  expect(document.querySelector(".selected-bar")).toBeNull();
  await userEvent.type(box, "NCT02343159{Enter}");
  const bar = document.querySelector<HTMLElement>(".selected-bar")!;
  expect(bar).not.toBeNull();
  expect(bar.textContent).toMatch(/NCT02343159/);
  expect(bar.querySelector(".selected-summary")).toBeNull();
  await userEvent.click(within(bar).getByRole("button", { name: /Details/ }));
  expect(scroll).toHaveBeenCalled();
  expect(scroll.mock.contexts[0]).toBe(screen.getByRole("region", { name: "Selected trial" }));
});
