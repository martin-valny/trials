import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { Explore } from "../src/components/explore/Explore";
import { SelectedTrial } from "../src/components/explore/SelectedTrial";
import { MechanismsPage } from "../src/components/mechanisms/MechanismsPage";
import { PipelinePage } from "../src/components/pipeline/PipelinePage";
import { Methods } from "../src/components/Methods";
import { TargetPage } from "../src/components/target/TargetPage";
import { TrialDetail } from "../src/components/TrialDetail";
import type { ExplorerFile } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

/** The old words (spec section 8, left column). "Approach", "Approaches" and "Mechanism graph" stay. */
const OLD: [string, RegExp][] = [
  ["Succeeded (drug moved to a later phase)", /Succeeded \(drug moved/],
  ["Completed, outcome unknown", /Completed, outcome unknown/],
  ["Succeeded via another drug", /Succeeded via/i],
  ["credited to the drug that moved on", /credited to the drug that moved on/],
  ["Share that succeeded", /Share that succeeded/],
  ["success pool", /success pool/i],
  ["Acts on", /Acts on/],
  ["binding agent", /binding agent/],
  ["Embedding of", /Embedding of/],
  ["cluster no more than chance", /cluster no more than chance/],
  ["shuffled labels", /shuffled labels/],
  ["Unclassified", /Unclassified/],
  ["Not yet sorted", /Not yet sorted/],
  ["proposed", /\bproposed\b/],
  ["Reactome pathway", /Reactome pathway/],
  ["GO term", /GO term/],
  ["Hollow", /Hollow:/],
  ["panel d", /panel d\b/],
  ["Click a dot in a", /Click a dot in/],
  ["Data may be stale", /Data may be stale/],
];

/** Explore is retired from the nav: no other page sends people "to the map" (Methods and Explore itself may). */
const noMapWords = () => {
  const text = document.body.textContent ?? "";
  expect(/on the map|Trial map|Show on map/.test(text), "a map link is on the page").toBe(false);
};

const noOldWords = () => {
  const text = document.body.textContent ?? "";
  for (const [name, re] of OLD) expect(re.test(text), `old wording "${name}" is on the page`).toBe(false);
};

function fakeContext(): CanvasRenderingContext2D {
  const noop = () => undefined;
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => (key === "canvas" ? undefined : key === "measureText" ? () => ({ width: 0 }) : noop),
    set: () => true,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => fakeContext()) as unknown as HTMLCanvasElement["getContext"],
  );
});

const base = readFixture<ExplorerFile>("explorer.json");

/** The fixture with a win in Cell & transplant and one credited to another drug. */
function withWins(): ExplorerFile {
  const f = structuredClone(base);
  f.trials[0] = { ...f.trials[0], approaches: ["cell"], kinds: ["ahsct"], outcome: "succeeded", in_pool: true };
  f.trials[1] = {
    ...f.trials[1],
    approaches: ["cell"],
    kinds: ["msc"],
    outcome: "succeeded",
    in_pool: true,
    succeeded_by: ["dimethyl fumarate"],
    succeeded_in: ["Multiple sclerosis"],
  };
  return f;
}

test("Pipeline and a target page use no old wording", async () => {
  stubFetch();
  render(
    <MemoryRouter initialEntries={["/"]}>
      <PipelinePage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1 });
  noOldWords();
  noMapWords();
});

test("a target page uses no old wording", async () => {
  stubFetch();
  render(
    <MemoryRouter initialEntries={["/target/cd20"]}>
      <Routes>
        <Route path="/target/:slug" element={<TargetPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: /CD20/ });
  noOldWords();
  noMapWords();
});

test("Approaches (targeted graph and a kind) use plain words", async () => {
  stubFetch({ "explorer.json": withWins() });
  const page = (route: string) =>
    render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/approaches/:approach" element={<MechanismsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  const first = page("/approaches/targeted?node=drug:dimethyl fumarate");
  const panel = await screen.findByRole("complementary", { name: /dimethyl fumarate/ });
  expect(within(panel).getByText("Target")).toBeInTheDocument();
  expect(panel.textContent).toMatch(/TargetNFE2L2/); // no pipeline row: just the gene
  expect(panel.textContent).not.toMatch(/\(gene/);
  noOldWords();
  first.unmount();

  const second = page("/approaches/targeted?node=drug:example drug");
  const drugPanel = await screen.findByRole("complementary", { name: /example drug/ });
  await waitFor(() => expect(drugPanel.textContent).toMatch(/TargetCD20\s*\(gene MS4A1\)/));
  second.unmount();

  page("/approaches/cell?kind=msc");
  const side = await screen.findByRole("complementary", { name: /Mesenchymal stem cells/ });
  expect(within(side).getByText("Thought to work by:")).toBeInTheDocument();
  expect(within(side).getByText(/Advanced, through dimethyl fumarate/)).toBeInTheDocument();
  expect(within(side).getByText(/finished trials that count/)).toBeInTheDocument();
  noOldWords();
});

test("Explore uses plain words and drops the p-value from the map page", async () => {
  stubFetch();
  renderAt(<Explore />, "/explore");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByRole("button", { name: "Intervention type: all" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Drug target class: all" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Drug format: all" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approach: all" })).toBeInTheDocument();
  for (const label of ["Drug target class", "Drug format"]) {
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument(); // the colour modes
  }
  expect(screen.getByText("How often the drug advanced to the next phase", { exact: false })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/p\s*[=<]\s*0\.\d/);
  noOldWords();
});

test("the selected-trial panel and the trial page use plain words", async () => {
  const f = withWins();
  render(
    <MemoryRouter>
      <SelectedTrial trial={null} names={f} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Click a dot on the map/)).toBeInTheDocument();
  expect(screen.getByText(/the map/)).toBeInTheDocument();
  noOldWords();

  stubFetch();
  renderAt(
    <Routes>
      <Route path="/trial/:nct" element={<TrialDetail />} />
    </Routes>,
    "/trial/NCT90000002",
  );
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  noOldWords();
});

test("outcome words in the trial card", () => {
  const f = withWins();
  render(
    <MemoryRouter>
      <SelectedTrial trial={f.trials[0]} names={f} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Advanced to next phase/)).toBeInTheDocument();
  noOldWords();

});

test("the graph note says Tap on a touch screen", async () => {
  stubFetch();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("pointer: coarse"),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  render(
    <MemoryRouter initialEntries={["/approaches/targeted"]}>
      <Routes>
        <Route path="/approaches/:approach" element={<MechanismsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Tap a node to light its neighbours/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Hover a node/);
});

test("Methods, with its not-yet-categorised lists, uses no old wording", async () => {
  const f = structuredClone(base);
  const mk = (i: number, extra: Partial<ExplorerFile["trials"][number]>): ExplorerFile["trials"][number] => ({
    ...f.trials[0]!,
    nct_id: `NCT7000${i}`,
    approaches: [],
    kinds: [],
    unsorted: [],
    ...extra,
  });
  const trials = [...f.trials, mk(1, { unsorted: ["mystery drug"] }), mk(2, { approaches: ["cell"], unsorted: ["other mystery"] })];
  stubFetch({ "explorer.json": { ...f, trials } });
  renderAt(<Methods />, "/methods#not-yet-categorised");
  await screen.findByRole("region", { name: "Names not yet categorised" });
  expect(screen.getByRole("region", { name: /in trials of other approaches/ })).toBeInTheDocument();
  // Methods keeps its own statistical wording (quoting what the map says), so only the retired
  // "sorted" names are checked on this page.
  expect(document.body.textContent).not.toMatch(/not yet sorted|unsorted names|Unclassified/i);
});
