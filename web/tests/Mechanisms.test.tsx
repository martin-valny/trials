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
        <Route path="/approaches/:approach" element={<MechanismsPage />} />
        <Route path="/approaches" element={<MechanismsPage />} />
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
  renderPage("/approaches/cell");
  const canvas = await screen.findByRole("region", { name: /^b\s*Cell & transplant/ });
  expect(within(canvas).getByRole("heading", { name: "Haematopoietic reset" })).toBeInTheDocument();
  expect(within(canvas).getByRole("heading", { name: "Mesenchymal cells" })).toBeInTheDocument();
  await userEvent.click(within(rail()).getByRole("button", { name: /^Non-drug care/ }));
  expect(where()).toBe("/approaches/nondrug");
  expect(await screen.findByRole("region", { name: /^b\s*Non-drug care/ })).toBeInTheDocument();
  expect(screen.getByText(/Success not defined/)).toBeInTheDocument();
});

test("an unknown or missing approach goes to Targeted drugs", async () => {
  stubFetch();
  renderPage("/approaches/bogus");
  expect(await screen.findByRole("region", { name: /^b\s*Targeted drugs/ })).toBeInTheDocument();
  expect(where()).toBe("/approaches/targeted");
});

test("rail rows are buttons with aria-pressed", async () => {
  stubFetch({ "explorer.json": withCell() });
  renderPage("/approaches/targeted");
  await screen.findByRole("region", { name: /^b\s*Targeted drugs/ });
  const buttons = within(rail()).getAllByRole("button");
  expect(buttons.map((b) => b.textContent?.match(/^\D+/)?.[0])).toEqual([
    "Targeted drugs",
    "Cell & transplant",
    "Antibody & plasma",
    "Tolerisation",
    "Broad immunomodulators",
    "Non-drug care",
  ]);
  expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  buttons.slice(1).forEach((b) => expect(b).toHaveAttribute("aria-pressed", "false"));
  expect(within(rail()).getByRole("button", { name: /^Non-drug care/ })).toHaveTextContent("success not defined");
});

test("MechanismsPage shows the empty message when filters exclude all", async () => {
  stubFetch({ "explorer.json": withCell() });
  renderPage("/approaches/cell");
  await screen.findByRole("region", { name: /^b\s*Cell & transplant/ });
  await userEvent.click(screen.getByRole("button", { name: "Outcome: all" }));
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  expect(screen.getByText("No trials match these filters.")).toBeInTheDocument();
  // The rail keeps every row, each at 0.
  const rows = within(rail()).getAllByRole("button");
  expect(rows).toHaveLength(6);
  rows.forEach((r) => expect(within(r).getByText("0")).toBeInTheDocument());
  expect(screen.getByText(/^Showing 0 of/)).toBeInTheDocument();
});

test('missing approaches shows "Approaches appear after the next update"', async () => {
  stubFetch({ "explorer.json": { ...base, approaches: [], kinds: {} } });
  renderPage("/approaches/targeted");
  expect(await screen.findByText(/Approaches appear after the next update\./)).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: /Approaches/ })).not.toBeInTheDocument();
});

test("a missing explorer file also says approaches appear after the next update", async () => {
  stubFetch({ "explorer.json": 404 });
  renderPage("/approaches/cell");
  expect(await screen.findByText(/Approaches appear after the next update\./)).toBeInTheDocument();
});

test('kind panel lists trials with /trial links and "List these trials"', async () => {
  const f = withCell();
  stubFetch({ "explorer.json": f });
  renderPage("/approaches/cell");
  await screen.findByRole("region", { name: /^b\s*Cell & transplant/ });
  const row = screen.getByRole("button", { name: /^aHSCT/ });
  await userEvent.click(row);
  expect(row).toHaveAttribute("aria-pressed", "true");
  const panel = screen.getByRole("complementary", { name: /aHSCT/ });
  const nct = f.trials[0].nct_id;
  expect(within(panel).getByRole("link", { name: nct })).toHaveAttribute("href", `/trial/${nct}`);
  expect(within(panel).getByText("Thought to work by:")).toBeInTheDocument();
  expect(within(panel).getByRole("link", { name: "source" })).toHaveAttribute("href", f.kinds.ahsct.source_url);
  await userEvent.click(within(panel).getByRole("link", { name: "List these trials →" }));
  expect(where()).toBe(`/trials?nct=${nct}&from=aHSCT`);
});

test("Escape closes the kind panel and returns focus to its row", async () => {
  stubFetch({ "explorer.json": withCell() });
  renderPage("/approaches/cell?kind=msc");
  const panel = await screen.findByRole("complementary", { name: /Mesenchymal stem cells/ });
  expect(within(panel).getByRole("heading", { name: /Mesenchymal stem cells/ })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  await vi.waitFor(() => expect(screen.getByRole("button", { name: /^Mesenchymal stem cells/ })).toHaveFocus());
});

test("rail has no Unclassified chip and shows the footnote", async () => {
  stubFetch();
  renderPage("/approaches/targeted");
  await screen.findByRole("region", { name: /^b\s*Targeted drugs/ });
  expect(within(rail()).queryByRole("button", { name: /Unclassified|Not yet categorised/ })).not.toBeInTheDocument();
  const u = base.trials.filter((t) => t.approaches.includes("unclassified"));
  const names = new Set(u.flatMap((t) => t.unsorted));
  const d = u.filter((t) => t.unsorted.length === 0).length;
  const note = within(rail()).getByText(/trials not yet categorised/);
  expect(note.textContent).toBe(
    `${u.length} trials not yet categorised (${names.size} unsorted names, ${d} diagnostic or not a treatment). How we sort →`,
  );
  expect(within(note).getByRole("link", { name: "How we sort →" })).toHaveAttribute("href", "/methods#not-yet-categorised");
});

test("/approaches/unclassified redirects to methods", async () => {
  stubFetch();
  renderPage("/approaches/unclassified");
  await vi.waitFor(() => expect(where()).toBe("/methods"));
});

test("targeted lede links to the pipeline", async () => {
  stubFetch();
  renderPage("/approaches/targeted");
  await screen.findByRole("region", { name: /^b\s*Targeted drugs/ });
  expect(screen.getByText(/Targeted drugs are on the Pipeline, grouped by target\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the pipeline →" })).toHaveAttribute("href", "/");
});

test("target node shows Open page link when the gene has a row", async () => {
  stubFetch();
  renderPage("/approaches/targeted?node=target:MS4A1");
  const panel = await screen.findByRole("complementary");
  expect(await within(panel).findByRole("link", { name: "Open CD20 page →" })).toHaveAttribute("href", "/target/cd20");
});

test("a target node whose gene has no row has no Open page link", async () => {
  stubFetch();
  renderPage("/approaches/targeted?node=target:NFE2L2");
  const panel = await screen.findByRole("complementary");
  await vi.waitFor(() => expect(within(panel).getByText("Targeted drugs › Target")).toBeInTheDocument());
  expect(within(panel).queryByRole("link", { name: /^Open .* page/ })).not.toBeInTheDocument();
});

test("from param shows Back link", async () => {
  stubFetch();
  renderPage("/approaches/targeted?node=target:MS4A1&from=cd20");
  expect(await screen.findByRole("link", { name: "← Back to CD20" })).toHaveAttribute("href", "/target/cd20");
  expect(screen.queryByRole("link", { name: /Back to/ })).toBeInTheDocument();
});

test("an unknown from row shows no Back link", async () => {
  stubFetch();
  renderPage("/approaches/targeted?from=nope");
  await screen.findByRole("region", { name: /^b\s*Targeted drugs/ });
  await screen.findByRole("link", { name: "Open the pipeline →" });
  expect(screen.queryByRole("link", { name: /Back to/ })).not.toBeInTheDocument();
});

/** The fixture with a Myasthenia gravis trial, so that disease can be chosen. */
function withMg(): ExplorerFile {
  const f = structuredClone(base);
  f.trials[0] = { ...f.trials[0], condition_labels: ["Myasthenia gravis"] };
  return f;
}

test("?disease=MG preselects MG on the graph page and keeps it in the query", async () => {
  stubFetch({ "explorer.json": withMg() });
  renderPage("/approaches/targeted?disease=MG");
  await screen.findByRole("region", { name: /^b\s*Targeted drugs/ });
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Disease: 1 of 6" })).toBeInTheDocument());
  expect(where()).toBe("/approaches/targeted?disease=MG");
  expect(screen.getByRole("link", { name: "Open the pipeline →" })).toHaveAttribute("href", "/?disease=MG");
});

test("an unknown disease code is ignored and dropped from the query", async () => {
  stubFetch({ "explorer.json": withMg() });
  renderPage("/approaches/targeted?disease=XYZ");
  await screen.findByRole("region", { name: /^b\s*Targeted drugs/ });
  await vi.waitFor(() => expect(where()).toBe("/approaches/targeted"));
  expect(screen.getByRole("button", { name: "Disease: all" })).toBeInTheDocument();
});

test("panel d links to /approaches/<approach>", () => {
  const f = withCell();
  render(
    <MemoryRouter>
      <SelectedTrial trial={f.trials[0]} names={f} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Show in mechanism graph" })).toHaveAttribute(
    "href",
    "#/approaches/cell?kind=ahsct",
  );
});

test("panel d links a targeted trial to its drug in the graph", () => {
  const t = base.trials.find((x) => x.drugs.includes("dimethyl fumarate"))!;
  render(
    <MemoryRouter>
      <SelectedTrial trial={t} names={base} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Show in mechanism graph" })).toHaveAttribute(
    "href",
    "#/approaches/targeted?node=drug%3Adimethyl+fumarate",
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
    elsewhere: 0,
    elsewhereTrials: [],
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

test("a kind's strip and panel read a win credited to another drug as such, never as its own success", async () => {
  const { KindTree } = await import("../src/components/mechanisms/KindTree");
  const { SidePanel } = await import("../src/components/mechanisms/SidePanel");
  const { LIGHT_PALETTE, outcomeColor } = await import("../src/lib/explorer");
  const kind = {
    key: "ahsct",
    label: "aHSCT",
    n: 3,
    outcomes: { succeeded: 0, stopped: 0, completed_unknown: 1, running: 0, unknown: 0 },
    elsewhere: 2,
    elsewhereTrials: ["NCT1", "NCT2"],
    finished: 3,
    succeeded: 0,
    rate: null,
    trials: ["NCT1", "NCT2", "NCT3"],
  };
  const { unmount } = render(
    <KindTree
      groups={[{ group: "Haematopoietic reset", rationale: null, source_url: null, kinds: [kind] }]}
      selected={null}
      successDefined
      palette={LIGHT_PALETTE}
      rationales={() => null}
      onSelect={() => undefined}
    />,
  );
  const row = screen.getByRole("button", { name: /^aHSCT/ });
  expect(row).toHaveTextContent("2 advanced, through another drug; 1 finished, no follow-on");
  const red = outcomeColor("succeeded", LIGHT_PALETTE);
  for (const seg of row.querySelectorAll<HTMLElement>(".strip-seg")) expect(seg.style.background).not.toBe(red);
  unmount();

  const t = (nct: string, outcome: ExplorerFile["trials"][number]["outcome"], by: string[]) => ({
    ...base.trials[0],
    nct_id: nct,
    outcome,
    succeeded_by: by,
  });
  render(
    <MemoryRouter>
      <SidePanel
        kind={kind}
        group="Haematopoietic reset"
        approach="Cell & transplant"
        rationale={null}
        trials={[t("NCT1", "succeeded", ["cyclophosphamide"]), t("NCT2", "succeeded", ["rituximab"]), t("NCT3", "completed_unknown", [])]}
        successDefined
        onClose={() => undefined}
      />
    </MemoryRouter>,
  );
  const panel = screen.getByRole("complementary");
  expect(panel).toHaveTextContent("3 trials: 2 advanced, through another drug; 1 finished, no follow-on.");
  expect(panel).toHaveTextContent("3 finished trials that count, 0 advanced");
  expect(within(panel).getByText(/Advanced, through cyclophosphamide/)).toBeInTheDocument();
});

test("Non-drug care's strip key has no Succeeded entry", async () => {
  const f = structuredClone(base);
  f.trials[0] = { ...f.trials[0], approaches: ["nondrug"], kinds: Object.keys(f.kinds).filter((k) => f.kinds[k].approach === "nondrug").slice(0, 1) };
  stubFetch({ "explorer.json": f });
  renderPage("/approaches/nondrug");
  const key = await screen.findByRole("list", { name: "Outcome strip key" });
  expect(key).not.toHaveTextContent("Advanced to next phase");
  expect(key).toHaveTextContent("Finished, no follow-on");
});

test("the rail footnote says '1 trial' for one", async () => {
  const f = structuredClone(base);
  for (const t of f.trials) t.approaches = t.approaches.filter((a) => a !== "unclassified");
  f.trials[0] = { ...f.trials[0], approaches: ["unclassified"], unsorted: ["x"] };
  stubFetch({ "explorer.json": f });
  renderPage("/approaches/targeted");
  await screen.findByRole("region", { name: /^b\s*Targeted drugs/ });
  expect(within(rail()).getByText(/not yet categorised/).textContent).toMatch(/^1 trial not yet categorised \(1 unsorted names, 0 /);
});
