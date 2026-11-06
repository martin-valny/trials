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
  const b = screen.getByRole("region", { name: /Share of finished trials that succeeded/ });
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
  expect(within(b).getByText(/^Tick: average across all finished trials \(\d+%\)\.$/)).toBeInTheDocument();
  const c = screen.getByRole("region", { name: /Trials by phase/ });
  expect(within(c).getByText("Phase 2")).toBeInTheDocument();
});

test("toggling a disease updates the visible count", async () => {
  await ready();
  expect(screen.getByText(`Showing ${N} of ${N} trials`)).toBeInTheDocument();
  const label = explorer.stats.by_condition[0].label;
  const withLabel = explorer.trials.filter((t) => t.condition_labels.includes(label)).length;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pill = screen.getByRole("button", { name: new RegExp(`^${esc} \\d`) });
  expect(pill).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(pill);
  expect(pill).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText(`Showing ${N - withLabel} of ${N} trials`)).toBeInTheDocument();
  await userEvent.click(pill);
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

test("outcome legend shows text labels not only colour", async () => {
  await ready();
  const n = (o: string) => explorer.trials.filter((t) => t.outcome === o).length;
  const labels: [string, string][] = [
    ["succeeded", "Succeeded (drug moved to a later phase)"],
    ["stopped", "Stopped early"],
    ["completed_unknown", "Completed, outcome unknown"],
    ["running", "Still running"],
    ["unknown", "Status unknown"],
  ];
  for (const [key, text] of labels) {
    expect(screen.getByRole("button", { name: `${text} ${n(key)}` })).toHaveAttribute("aria-pressed", "true");
  }
  // Toggling an outcome off filters it out.
  await userEvent.click(screen.getByRole("button", { name: `Still running ${n("running")}` }));
  expect(screen.getByText(`Showing ${N - n("running")} of ${N} trials`)).toBeInTheDocument();
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
  const b = screen.getByRole("region", { name: /Share of finished trials that succeeded/ });
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

test("legend leads with panel d, then Find, then Colour", async () => {
  await ready();
  const d = screen.getByRole("region", { name: "Selected trial" });
  const find = screen.getByLabelText("Find a trial");
  const colour = screen.getByRole("group", { name: "Colour" });
  const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(follows(d, find)).toBe(true);
  expect(follows(find, colour)).toBe(true);
});

test("unknown outcome legend swatch is a ring, not a filled dot", async () => {
  await ready();
  const n = explorer.trials.filter((t) => t.outcome === "unknown").length;
  const pill = screen.getByRole("button", { name: `Status unknown ${n}` });
  expect(pill.querySelector(".swatch.ring")).not.toBeNull();
  const running = explorer.trials.filter((t) => t.outcome === "running").length;
  expect(screen.getByRole("button", { name: `Still running ${running}` }).querySelector(".swatch.ring")).toBeNull();
});
