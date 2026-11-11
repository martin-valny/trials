import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GraphCanvas, placeNode } from "../src/components/mechanisms/GraphCanvas";
import { MechanismsPage } from "../src/components/mechanisms/MechanismsPage";
import { LIGHT_PALETTE } from "../src/lib/explorer";
import type { GraphFile } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

const graph = readFixture<GraphFile>("mechanisms.json");
const W = 600;
const H = 400;

let frames: FrameRequestCallback[] = [];
let texts: string[] = [];
let spots: { text: string; x: number; y: number }[] = [];
const step = () =>
  act(() => {
    const run = frames;
    frames = [];
    run.forEach((cb) => cb(performance.now()));
  });

beforeEach(() => {
  frames = [];
  texts = [];
  spots = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => {
      if (key === "fillText")
        return (t: string, x: number, y: number) => {
          texts.push(t);
          spots.push({ text: t, x, y });
        };
      if (key === "measureText") return (t: string) => ({ width: t.length * 6 });
      return () => undefined;
    },
    set: () => true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement["getContext"],
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ x: 0, y: 0, left: 0, top: 0, width: W, height: H, right: W, bottom: H, toJSON: () => ({}) }) as DOMRect,
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const click = (el: Element, x: number, y: number) => {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" });
};

test("GraphCanvas focuses on click and clears on Escape", () => {
  const onFocus = vi.fn();
  const props = { graph, lit: null, red: new Set<string>(), minGroup: 10, palette: LIGHT_PALETTE, topShare: 0 };
  const { rerender } = render(<GraphCanvas {...props} focus={null} onFocus={onFocus} />);
  const canvas = screen.getByRole("img", { name: /^Mechanism graph of 2 drugs, 2 targets and 9 pathways/ });
  const drug = graph.nodes.find((n) => n.id === "drug:dimethyl fumarate")!;
  const p = placeNode(drug, W, H);
  click(canvas, p.x + 1, p.y);
  expect(onFocus).toHaveBeenLastCalledWith("drug:dimethyl fumarate");

  rerender(<GraphCanvas {...props} focus="drug:dimethyl fumarate" onFocus={onFocus} />);
  step();
  // The focused chain is labelled: the drug, its target and its pathways.
  expect(texts).toContain("dimethyl fumarate");
  expect(texts).toContain("NFE2L2");
  expect(texts).not.toContain("MS4A1");
  fireEvent.keyDown(canvas, { key: "Escape" });
  expect(onFocus).toHaveBeenLastCalledWith(null);

  // A click on empty space clears too.
  click(canvas, 2, 2);
  expect(onFocus).toHaveBeenLastCalledWith(null);
});

test("GraphCanvas labels only top-level pathways at rest, and a hovered node's neighbours", () => {
  render(
    <GraphCanvas
      graph={graph}
      focus={null}
      onFocus={() => undefined}
      lit={null}
      red={new Set()}
      minGroup={10}
      palette={LIGHT_PALETTE}
      topShare={0}
    />,
  );
  step();
  const top = graph.nodes.filter((n) => n.top_level).map((n) => n.label);
  expect(new Set(texts)).toEqual(new Set(top));
  texts = [];
  const target = graph.nodes.find((n) => n.id === "target:MS4A1")!;
  const p = placeNode(target, W, H);
  fireEvent.pointerMove(screen.getByRole("img"), { clientX: p.x, clientY: p.y, pointerType: "mouse" });
  step();
  expect(texts).toEqual(expect.arrayContaining(["MS4A1", "example drug"]));
  expect(texts).not.toContain("dimethyl fumarate");
});

test("numbered (phone): at rest the top-level pathways carry numerals, never their names", () => {
  render(
    <GraphCanvas
      graph={graph}
      focus={null}
      onFocus={() => undefined}
      lit={null}
      red={new Set()}
      minGroup={10}
      palette={LIGHT_PALETTE}
      topShare={0}
      numbered
    />,
  );
  step();
  const top = graph.nodes.filter((n) => n.top_level);
  expect(new Set(texts)).toEqual(new Set(top.map((_, i) => String(i + 1))));
  // Something lit is named in full, as side by side.
  texts = [];
  const target = graph.nodes.find((n) => n.id === "target:MS4A1")!;
  const p = placeNode(target, W, H);
  fireEvent.pointerMove(screen.getByRole("img"), { clientX: p.x, clientY: p.y, pointerType: "mouse" });
  step();
  expect(texts).toEqual(expect.arrayContaining(["MS4A1", "example drug"]));
});

test("a phone numeral moves off another node's mark: right and left blocked, it sits above or below", () => {
  const g = structuredClone(graph);
  const top = g.nodes.find((n) => n.label === "Immune System")!;
  for (const n of g.nodes) if (n.top_level && n !== top) n.top_level = false;
  const p = placeNode(top, W, H);
  const unit = (x: number) => ((x - 28) / (W - 56)) * 2 - 1;
  const right = g.nodes.find((n) => n.kind === "drug")!;
  right.x = unit(p.x + 20);
  right.y = top.y;
  const left = g.nodes.find((n) => n.kind === "target")!;
  left.x = unit(p.x - 20);
  left.y = top.y;
  render(
    <GraphCanvas
      graph={g}
      focus={null}
      onFocus={() => undefined}
      lit={null}
      red={new Set()}
      minGroup={10}
      palette={LIGHT_PALETTE}
      topShare={0}
      numbered
    />,
  );
  step();
  const one = spots.find((t) => t.text === "1")!;
  expect(one).toBeDefined();
  expect(Math.abs(one.y - p.y)).toBeGreaterThan(8);
});

/** Shows where the app went, so a test can read it. */
function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderPage(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/mechanisms/:approach" element={<MechanismsPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("search box selects a node and opens the side panel", async () => {
  stubFetch();
  renderPage("/mechanisms/targeted");
  const box = await screen.findByRole("combobox", { name: "Find a drug, target or pathway" });
  await userEvent.type(box, "ms4");
  const option = screen.getByRole("option", { name: /MS4A1/ });
  await userEvent.click(option);
  const panel = await screen.findByRole("complementary", { name: /MS4A1/ });
  expect(within(panel).getByText(/Acted on by/)).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: "example drug" })).toBeInTheDocument();
  expect(within(panel).getByRole("link", { name: "NCT90000001" })).toHaveAttribute("href", "/trial/NCT90000001");
  expect(within(panel).getByRole("link", { name: "List these trials →" })).toBeInTheDocument();
  expect(screen.getAllByTestId("where").at(-1)!.textContent).toBe("/mechanisms/targeted?node=target%3AMS4A1");

  // Enter picks the first match.
  await userEvent.type(box, "dimethyl{Enter}");
  expect(await screen.findByRole("complementary", { name: /dimethyl fumarate/ })).toBeInTheDocument();
});

test("a drug panel shows its mechanism, target and ChEMBL link; a pathway its Reactome source", async () => {
  stubFetch();
  renderPage("/mechanisms/targeted?node=drug%3Adimethyl%20fumarate");
  const panel = await screen.findByRole("complementary", { name: /dimethyl fumarate/ });
  expect(within(panel).getByText("NRF2 activator")).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: "NFE2L2" })).toBeInTheDocument();
  expect(within(panel).getByRole("link", { name: /ChEMBL/ })).toHaveAttribute(
    "href",
    "https://www.ebi.ac.uk/chembl/explore/compound/CHEMBL2107333",
  );
  await userEvent.click(within(panel).getByRole("button", { name: "NFE2L2" }));
  const target = await screen.findByRole("complementary", { name: /NFE2L2/ });
  await userEvent.click(within(target).getByRole("button", { name: "Nuclear events mediated by NFE2L2" }));
  const pathway = await screen.findByRole("complementary", { name: /Nuclear events mediated by NFE2L2/ });
  expect(within(pathway).getByRole("link", { name: /Reactome/ })).toHaveAttribute(
    "href",
    "https://reactome.org/content/detail/R-HSA-9759194",
  );
});

test('class target node shows "no pathway" in the side panel', async () => {
  const g = structuredClone(graph);
  g.nodes.push({
    id: "class:DNA inhibitor",
    kind: "target",
    label: "DNA inhibitor",
    x: 0,
    y: 0,
    n: 1,
    finished: 0,
    succeeded: 0,
    stopped: 1,
    running: 0,
    conditions: [],
  });
  g.edges.push({ source: "drug:dimethyl fumarate", target: "class:DNA inhibitor", kind: "acts_on" });
  stubFetch({ "mechanisms.json": g });
  renderPage("/mechanisms/targeted?node=class%3ADNA%20inhibitor");
  const panel = await screen.findByRole("complementary", { name: /DNA inhibitor/ });
  expect(within(panel).getByText(/no pathway/)).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: "dimethyl fumarate" })).toBeInTheDocument();
});

test("Close and Escape clear the focused node", async () => {
  stubFetch();
  renderPage("/mechanisms/targeted?node=target%3AMS4A1");
  const panel = await screen.findByRole("complementary", { name: /MS4A1/ });
  expect(within(panel).getByRole("heading", { name: /MS4A1/ })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("where").at(-1)!.textContent).toBe("/mechanisms/targeted");
});

test('a missing mechanisms.json says "The graph appears after the next update."', async () => {
  stubFetch({ "mechanisms.json": 404 });
  renderPage("/mechanisms/targeted");
  expect(await screen.findByText("The graph appears after the next update.")).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: /Mechanism graph/ })).not.toBeInTheDocument();
});

test("a filter lights the reached nodes and names them in the canvas summary", async () => {
  stubFetch();
  renderPage("/mechanisms/targeted");
  await screen.findByRole("img", { name: /Mechanism graph/ });
  await userEvent.click(screen.getByRole("button", { name: "Outcome: all" }));
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Stopped early/ }));
  // Only the stopped trials are lit: both drugs have one.
  expect(await screen.findByText(/reached by the 2 trials shown/)).toBeInTheDocument();
});

/** The fixture graph with one more drug left out by the cap. */
function withCut(): GraphFile {
  const g = structuredClone(graph);
  g.cut = {
    drugs: { before: 3, after: 2 },
    targets: { before: 3, after: 2 },
    pathways: { before: 9, after: 9 },
    min_trials: 4,
    all_succeeded: true,
    dropped: [{ drug: "rare drug", n: 2, trials: ["NCT03838770", "NCT04334031"] }],
  };
  return g;
}

test("the canvas caption says how many drugs the graph draws and by what rule", async () => {
  stubFetch({ "mechanisms.json": withCut() });
  renderPage("/mechanisms/targeted");
  await screen.findByRole("img", { name: /Mechanism graph/ });
  expect(
    screen.getByText("Showing 2 of 3 drugs: every drug credited with a success and those in 4 or more trials."),
  ).toBeInTheDocument();
});

test("Find lists a dropped drug; choosing it says why it is not drawn and hands its trials to the map", async () => {
  stubFetch({ "mechanisms.json": withCut() });
  renderPage("/mechanisms/targeted");
  const box = await screen.findByRole("combobox", { name: "Find a drug, target or pathway" });
  await userEvent.type(box, "rare");
  const option = screen.getByRole("option", { name: /rare drug/ });
  expect(within(option).getByText("not drawn")).toBeInTheDocument();
  await userEvent.click(option);
  const note = await screen.findByRole("status", { name: "rare drug" });
  expect(note).toHaveTextContent(
    "rare drug is not drawn: it is in 2 trials, and the graph shows every drug credited with a success and those in 4 or more trials.",
  );
  expect(within(note).getByRole("link", { name: "List its 2 trials →" })).toHaveAttribute(
    "href",
    "/trials?nct=NCT03838770%2CNCT04334031&from=rare+drug",
  );
  expect(screen.getAllByTestId("where").at(-1)!.textContent).toBe("/mechanisms/targeted?node=drug%3Arare+drug");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

test("a link to a dropped drug's node (?node=) explains it is not drawn", async () => {
  stubFetch({ "mechanisms.json": withCut() });
  renderPage("/mechanisms/targeted?node=drug%3Arare%20drug");
  expect(await screen.findByRole("status", { name: "rare drug" })).toHaveTextContent(/rare drug is not drawn/);
});

test("an older mechanisms.json without the cut still renders, with no caption (R19)", async () => {
  const g = structuredClone(graph);
  delete g.cut;
  stubFetch({ "mechanisms.json": g });
  renderPage("/mechanisms/targeted");
  await screen.findByRole("img", { name: /Mechanism graph of 2 drugs/ });
  expect(screen.queryByText(/^Showing \d+ of \d+ drugs/)).not.toBeInTheDocument();
  const box = screen.getByRole("combobox", { name: "Find a drug, target or pathway" });
  await userEvent.type(box, "dimethyl");
  expect(screen.getByRole("option", { name: /dimethyl fumarate/ })).toBeInTheDocument();
});

test("on a phone the graph's top-level pathways are keyed by numeral under the canvas", async () => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("max-width: 640px"),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  stubFetch();
  renderPage("/mechanisms/targeted");
  const key = await screen.findByRole("list", { name: "Graph labels" });
  const top = graph.nodes.filter((n) => n.top_level);
  expect(within(key).getAllByRole("listitem")).toHaveLength(top.length);
  expect(within(key).getAllByRole("listitem")[0]).toHaveTextContent(/^1/);
});

test("side by side there is no numeral key; the caption names the Reactome release in a sentence", async () => {
  stubFetch();
  renderPage("/mechanisms/targeted");
  await screen.findByRole("img", { name: /Mechanism graph/ });
  expect(screen.queryByRole("list", { name: "Graph labels" })).not.toBeInTheDocument();
  expect(screen.getByText(/Pathways from Reactome release test\./)).toBeInTheDocument();
});
