import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { MechanismsPage } from "../src/components/mechanisms/MechanismsPage";
import { SelectedTrial } from "../src/components/explore/SelectedTrial";
import type { ExplorerFile } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

const base = readFixture<ExplorerFile>("explorer.json");

/** The fixture with two trials moved into Cell & transplant (aHSCT and mesenchymal cells). */
function withCell(): ExplorerFile {
  const f = structuredClone(base);
  f.trials[0] = { ...f.trials[0], approaches: ["cell"], kinds: ["ahsct"] };
  f.trials[1] = { ...f.trials[1], approaches: ["cell"], kinds: ["msc"] };
  return f;
}

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
        <Route path="/mechanisms" element={<MechanismsPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getAllByTestId("where").at(-1)!.textContent;
const rail = () => screen.getByRole("navigation", { name: /Approaches/ });

beforeEach(() => {
  vi.restoreAllMocks();
});

test("MechanismsPage selects from the URL and switches on rail click", async () => {
  stubFetch({ "explorer.json": withCell() });
  renderPage("/mechanisms/cell");
  const canvas = await screen.findByRole("region", { name: /^b\s*Cell & transplant/ });
  expect(within(canvas).getByRole("heading", { name: "Haematopoietic reset" })).toBeInTheDocument();
  expect(within(canvas).getByRole("heading", { name: "Mesenchymal cells" })).toBeInTheDocument();
  await userEvent.click(within(rail()).getByRole("button", { name: /^Non-drug care/ }));
  expect(where()).toBe("/mechanisms/nondrug");
  expect(await screen.findByRole("region", { name: /^b\s*Non-drug care/ })).toBeInTheDocument();
  expect(screen.getByText(/Success not defined/)).toBeInTheDocument();
});

test("an unknown or missing approach goes to Targeted drugs", async () => {
  stubFetch();
  renderPage("/mechanisms/bogus");
  expect(await screen.findByRole("region", { name: /^b\s*Targeted drugs/ })).toBeInTheDocument();
  expect(where()).toBe("/mechanisms/targeted");
});

test("rail rows are buttons with aria-pressed", async () => {
  stubFetch({ "explorer.json": withCell() });
  renderPage("/mechanisms/targeted");
  await screen.findByRole("region", { name: /^b\s*Targeted drugs/ });
  const buttons = within(rail()).getAllByRole("button");
  expect(buttons.map((b) => b.textContent?.match(/^\D+/)?.[0])).toEqual([
    "Targeted drugs",
    "Cell & transplant",
    "Antibody & plasma",
    "Tolerisation",
    "Broad immunomodulators",
    "Non-drug care",
    "Unclassified",
  ]);
  expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  buttons.slice(1).forEach((b) => expect(b).toHaveAttribute("aria-pressed", "false"));
  expect(within(rail()).getByRole("button", { name: /^Non-drug care/ })).toHaveTextContent("success not defined");
});

test("MechanismsPage shows the empty message when filters exclude all", async () => {
  stubFetch({ "explorer.json": withCell() });
  renderPage("/mechanisms/cell");
  await screen.findByRole("region", { name: /^b\s*Cell & transplant/ });
  await userEvent.click(screen.getByRole("button", { name: "Outcome: all" }));
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  expect(screen.getByText("No trials match these filters.")).toBeInTheDocument();
  // The rail keeps every row, each at 0.
  const rows = within(rail()).getAllByRole("button");
  expect(rows).toHaveLength(7);
  rows.forEach((r) => expect(within(r).getByText("0")).toBeInTheDocument());
  expect(screen.getByText(/^Showing 0 of/)).toBeInTheDocument();
});

test('missing approaches shows "Approaches appear after the next update"', async () => {
  stubFetch({ "explorer.json": { ...base, approaches: [], kinds: {} } });
  renderPage("/mechanisms/targeted");
  expect(await screen.findByText(/Approaches appear after the next update\./)).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: /Approaches/ })).not.toBeInTheDocument();
});

test("a missing explorer file also says approaches appear after the next update", async () => {
  stubFetch({ "explorer.json": 404 });
  renderPage("/mechanisms/cell");
  expect(await screen.findByText(/Approaches appear after the next update\./)).toBeInTheDocument();
});

test('kind panel lists trials with /trial links and "Show these trials on the map"', async () => {
  const f = withCell();
  stubFetch({ "explorer.json": f });
  renderPage("/mechanisms/cell");
  await screen.findByRole("region", { name: /^b\s*Cell & transplant/ });
  const row = screen.getByRole("button", { name: /^aHSCT/ });
  await userEvent.click(row);
  expect(row).toHaveAttribute("aria-pressed", "true");
  const panel = screen.getByRole("complementary", { name: /aHSCT/ });
  const nct = f.trials[0].nct_id;
  expect(within(panel).getByRole("link", { name: nct })).toHaveAttribute("href", `/trial/${nct}`);
  expect(within(panel).getByText(/^proposed$/)).toBeInTheDocument();
  expect(within(panel).getByRole("link", { name: "source" })).toHaveAttribute("href", f.kinds.ahsct.source_url);
  await userEvent.click(within(panel).getByRole("link", { name: "Show these trials on the map" }));
  expect(where()).toBe(`/explore?nct=${nct}&from=aHSCT`);
});

test("Escape closes the kind panel and returns focus to its row", async () => {
  stubFetch({ "explorer.json": withCell() });
  renderPage("/mechanisms/cell?kind=msc");
  const panel = await screen.findByRole("complementary", { name: /Mesenchymal stem cells/ });
  expect(within(panel).getByRole("heading", { name: /Mesenchymal stem cells/ })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  await vi.waitFor(() => expect(screen.getByRole("button", { name: /^Mesenchymal stem cells/ })).toHaveFocus());
});

test("unclassified lists its not-yet-sorted names", async () => {
  stubFetch();
  renderPage("/mechanisms/unclassified");
  const canvas = await screen.findByRole("region", { name: /^b\s*Unclassified/ });
  const group = within(canvas).getByRole("region", { name: "Not yet sorted" });
  for (const t of base.trials.filter((x) => x.approaches.includes("unclassified")))
    for (const name of t.unsorted)
      expect(within(group).getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
});

test("panel d links to /mechanisms/<approach>", () => {
  const f = withCell();
  render(
    <MemoryRouter>
      <SelectedTrial trial={f.trials[0]} names={f} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Show in mechanism graph" })).toHaveAttribute(
    "href",
    "#/mechanisms/cell?kind=ahsct",
  );
});

test("a long group shows its first 20 rows until Show more", async () => {
  const { KindTree } = await import("../src/components/mechanisms/KindTree");
  const { LIGHT_PALETTE } = await import("../src/lib/explorer");
  const kinds = Array.from({ length: 23 }, (_, i) => ({
    key: `unsorted:name ${i}`,
    label: `name ${i}`,
    n: 1,
    outcomes: { succeeded: 0, stopped: 0, completed_unknown: 0, running: 1, unknown: 0 },
    finished: 0,
    succeeded: 0,
    rate: null,
    trials: [`NCT${i}`],
  }));
  render(
    <KindTree
      groups={[{ group: "Not yet sorted", rationale: null, source_url: null, kinds }]}
      selected={null}
      successDefined
      palette={LIGHT_PALETTE}
      rationales={() => null}
      onSelect={() => undefined}
    />,
  );
  expect(document.querySelectorAll(".kind-row")).toHaveLength(20);
  await userEvent.click(screen.getByRole("button", { name: "Show 3 more, 3 trials" }));
  expect(document.querySelectorAll(".kind-row")).toHaveLength(23);
});
