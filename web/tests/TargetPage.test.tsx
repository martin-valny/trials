import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { TargetPage } from "../src/components/target/TargetPage";
import { axisStart } from "../src/components/target/TargetTimeline";
import type { PipelineFile } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderPage(route = "/target/cd20") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/target/:slug" element={<TargetPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

/** The fixture with a second disease on one mark, an undated trial and a stopped trial's reason changed on demand. */
function variant(edit: (f: PipelineFile) => void): PipelineFile {
  const f = readFixture<PipelineFile>("pipeline.json");
  edit(f);
  return f;
}

test("renders lede and key numbers for cd20 from the fixture", async () => {
  stubFetch();
  renderPage();
  const h1 = await screen.findByRole("heading", { level: 1 });
  expect(h1).toHaveTextContent("CD20");
  expect(h1).toHaveTextContent("gene MS4A1 · B-cell depletion · antibodies");
  const lede = screen.getByText((_, el) => el?.tagName === "P" && el.classList.contains("tl"));
  expect(lede.textContent).toBe("7 of 8 trials are running, from 1 company or academic group. 0 advanced to a later phase; 1 stopped.");
  const keys = screen.getByLabelText("Key numbers");
  expect(within(keys).getByText("still running").previousSibling).toHaveTextContent("7");
  expect(within(keys).getByText("stopped").previousSibling).toHaveTextContent("1");
  expect(screen.getByRole("link", { name: "Pipeline" })).toHaveAttribute("href", "/");
});

test("disease chip sets ?disease and refilters", async () => {
  const f = variant((p) => {
    p.rows[0]!.marks[1]!.dz = ["MG"];
  });
  stubFetch({ "pipeline.json": f });
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByRole("button", { name: /^MG\s*1$/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^MG\s*1$/ }));
  expect(screen.getByTestId("where")).toHaveTextContent("/target/cd20?disease=MG");
  expect(screen.getByText(/1 of 1 trial is running/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pipeline" })).toHaveAttribute("href", "/?disease=MG");
});

test("unknown slug", async () => {
  stubFetch();
  renderPage("/target/nope");
  expect(await screen.findByText(/No target called 'nope'\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Back to the pipeline/ })).toHaveAttribute("href", "/");
});

test("timeline omits undated trials but the list keeps them", async () => {
  const f = variant((p) => {
    const m = p.rows[0]!.marks[2]!;
    m.y = null;
    m.y2 = null;
  });
  stubFetch({ "pipeline.json": f });
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(container.querySelectorAll("svg [data-n]").length).toBe(7);
  expect(container.querySelector('svg [data-n="NCT90000004"]')).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "List these trials" }));
  const list = screen.getByRole("list", { name: "Trials" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(8);
  expect(within(list).getByRole("button", { name: "NCT90000004" }).closest("li")).toHaveTextContent("dates not given");
});

test("company link goes to /?company=", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByRole("link", { name: "Example Pharma" })).toHaveAttribute("href", "/?company=Example+Pharma");
});

test("stop groups hidden when showGroups is false", async () => {
  const shown = variant(() => undefined);
  stubFetch({ "pipeline.json": shown });
  const a = renderPage();
  await screen.findByRole("heading", { level: 1 });
  // One stopped trial, reason "Not given": chips shown.
  expect(screen.getByLabelText("Reason groups")).toBeInTheDocument();
  a.unmount();

  const hidden = variant((p) => {
    const marks = p.rows[0]!.marks;
    for (const [i, m] of marks.slice(0, 4).entries()) {
      m.s = "stop";
      p.trials[m.n] = { t: `Study ${m.n}`, why: "x", r: i === 0 ? "Funding" : "Other" };
    }
  });
  stubFetch({ "pipeline.json": hidden });
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByLabelText("Reason groups")).not.toBeInTheDocument();
  expect(screen.getByText(/What stopped, and why/)).toBeInTheDocument();
});

test("panel d hides the graph link when mechanisms.json is missing", async () => {
  stubFetch();
  const a = renderPage();
  const link = await screen.findByRole("link", { name: /Open in the mechanism graph/ });
  expect(link.getAttribute("href")).toBe("/approaches/targeted?node=target:MS4A1&from=cd20");
  const chain = screen.getByLabelText("Mechanism chain");
  expect(within(chain).getByText("Immune System")).toBeInTheDocument();
  a.unmount();

  stubFetch({ "mechanisms.json": 404 });
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const chain2 = await screen.findByLabelText("Mechanism chain");
  expect(within(chain2).getByText("gene MS4A1")).toBeInTheDocument();
  expect(within(chain2).queryByText("Immune System")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open in the mechanism graph/ })).not.toBeInTheDocument();
});

test("List these trials link carries every NCT", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const link = screen.getByRole("link", { name: /List these 8 trials →/ });
  const href = link.getAttribute("href")!;
  expect(href.startsWith("/trials?nct=")).toBe(true);
  const q = new URLSearchParams(href.split("?")[1]);
  expect(q.get("nct")!.split(",").sort()).toEqual(
    ["NCT90000001", "NCT90000002", "NCT90000004", "NCT90000005", "NCT90000006", "NCT90000007", "NCT90000008", "NCT90000099"],
  );
  expect(q.get("from")).toBe("CD20");
});

const ledeText = () => screen.getByText((_, el) => el?.tagName === "P" && el.classList.contains("tl")).textContent;

test("lede counts industry parents with a running trial only", async () => {
  const f = variant((p) => {
    p.sponsors.push({ raw: "Some University", parent: "Some University", kind: "academic" });
    p.rows[0]!.marks[3]!.sp = 2;
  });
  stubFetch({ "pipeline.json": f });
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(ledeText()).toContain("7 of 8 trials are running, from 1 company or academic group.");
  expect(screen.getByLabelText("Key numbers")).toBeInTheDocument();
});

test("a valid disease with no trials in the row shows calm copy and keeps the chip", async () => {
  stubFetch();
  renderPage("/target/cd20?disease=AE");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByText(/0 of 0/)).not.toBeInTheDocument();
  expect(ledeText()).toBe("No CD20 trials in AE.");
  expect(screen.getByRole("button", { name: /^AE\s*0$/ })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("link", { name: /Show all diseases/ }));
  expect(screen.getByTestId("where")).toHaveTextContent("/target/cd20");
  expect(screen.getByTestId("where").textContent).not.toContain("disease");
  expect(ledeText()).toMatch(/^7 of 8 trials/);
});

test("a trial marked twice in a row is counted once, with no duplicate keys", async () => {
  const f = variant((p) => {
    p.rows[0]!.marks.push({ ...p.rows[0]!.marks[1]! });
  });
  stubFetch({ "pipeline.json": f });
  const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(ledeText()).toMatch(/^7 of 8 trials are running/);
  expect(container.querySelectorAll('svg [data-n="NCT90000002"]').length).toBe(1);
  expect(err.mock.calls.filter((c) => String(c[0]).includes("same key"))).toHaveLength(0);
  err.mockRestore();
});

test("with a disease set, every outgoing link carries it", async () => {
  const f = variant((p) => {
    p.rows[0]!.related = ["cd19"];
  });
  stubFetch({ "pipeline.json": f });
  renderPage("/target/cd20?disease=MS");
  await screen.findByRole("heading", { level: 1 });
  const graph = await screen.findByRole("link", { name: /Open in the mechanism graph/ });
  expect(graph.getAttribute("href")).toBe("/approaches/targeted?node=target:MS4A1&from=cd20&disease=MS");
  expect(screen.getByRole("link", { name: /List these \d+ trials →/ }).getAttribute("href")).toMatch(/&disease=MS$/);
  const company = within(screen.getByText("Who is working on CD20").closest("div")!.parentElement!).getAllByRole("link")[0]!;
  expect(company.getAttribute("href")).toMatch(/^\/\?.*disease=MS/);
  expect(company.getAttribute("href")).toMatch(/company=/);
  expect(screen.getByRole("link", { name: "CD19" }).getAttribute("href")).toBe("/target/cd19?disease=MS");
});

test("without a disease the links stay as they were", async () => {
  stubFetch();
  renderPage();
  const graph = await screen.findByRole("link", { name: /Open in the mechanism graph/ });
  expect(graph.getAttribute("href")).not.toContain("disease");
  expect(screen.getByRole("link", { name: /List these \d+ trials →/ }).getAttribute("href")).not.toContain("disease");
});

test("on a phone the graph link sits under the chain, not in the hidden section caption", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  try {
    stubFetch();
    const { container } = renderPage();
    const link = await screen.findByRole("link", { name: /Open in the mechanism graph/ });
    expect(link.closest(".sec-h")).toBeNull();
    expect(link.closest("p")).toHaveClass("chain-graph");
    expect(container.querySelectorAll("a").length).toBeGreaterThan(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("the timeline axis starts at the five-year mark before the earliest start, never before 2000", () => {
  expect(axisStart([{ y: 2018 }, { y: 2021 }, { y: null }])).toBe(2015);
  expect(axisStart([{ y: 2020 }])).toBe(2015);
  expect(axisStart([{ y: 2021 }])).toBe(2020);
  expect(axisStart([{ y: 1994 }])).toBe(2000);
  expect(axisStart([{ y: null }])).toBe(2000);
});

test("List these trials link is singular for a one-trial row", async () => {
  const f = variant((p) => {
    p.rows[0]!.marks = [p.rows[0]!.marks[0]!];
  });
  stubFetch({ "pipeline.json": f });
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByRole("link", { name: "List this trial →" })).toBeInTheDocument();
  expect(screen.queryByText(/List these 1 trials/)).not.toBeInTheDocument();
});

// ---------------------------------------------------------------- e. stop-risk estimates
const RISK_H = "Running trials, estimated chance of stopping early";
const NOTE =
  "Statistical estimate from public registry data. Not a statement about any sponsor or trial. The model is often wrong; see Methods for accuracy.";
const riskPanel = () => screen.getByRole("region", { name: RISK_H });

test("renders the risk panel with heading and rows", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  const panel = riskPanel();
  expect(panel).toHaveTextContent("CD20 · All diseases · 7 running. Tick = typical for phase 2 drug trials.");
  const rows = within(within(panel).getByRole("list", { name: "Running trials by estimate" })).getAllByRole("listitem");
  expect(rows).toHaveLength(7);
  // Highest estimate first; a near-zero range never reads "(0–0)".
  expect(rows[0]).toHaveTextContent("65% (53–74)");
  expect(rows.find((r) => r.textContent?.includes("NCT90000006"))).toHaveTextContent("<1% (0–<1)");
  expect(panel.textContent).not.toContain("(0–0)");
  const row = rows.find((r) => r.textContent?.includes("NCT90000002"))!;
  expect(row).toHaveTextContent("example drug · Phase 2 · Example Pharma");
  expect(row).toHaveTextContent("25% (3–25)");
  expect(row).toHaveTextContent("typical 20%");
  expect(row).toHaveTextContent("near typical 20%"); // its range (3–25) contains the typical rate
  expect(within(row).getByRole("img", { name: "Estimated 25% (3–25); typical 20%" })).toBeInTheDocument();
  expect(within(row).getByRole("link", { name: "NCT90000002" })).toHaveAttribute("href", "/trial/NCT90000002");
  const more = within(row).getByRole("button", { name: /Main factors/ });
  expect(more).toHaveAttribute("aria-expanded", "false");
  expect(row).not.toHaveTextContent("Few sites (1)");
  await userEvent.click(more);
  expect(more).toHaveAttribute("aria-expanded", "true");
  const factors = within(row).getByRole("list", { name: "Main factors" });
  expect(within(factors).getAllByRole("listitem")).toHaveLength(3);
  expect(factors).toHaveTextContent("Few sites (1)");
  expect(factors).toHaveTextContent("lowers");
  expect(within(factors).queryByRole("link")).not.toBeInTheDocument();
  expect(more).toHaveAttribute("aria-controls", factors.closest(".rk-why")!.id);
  expect(within(row.querySelector(".rk-id") as HTMLElement).getByRole("link", { name: /ClinicalTrials\.gov/ })).toHaveAttribute(
    "href",
    "https://clinicaltrials.gov/study/NCT90000002",
  );
  expect(within(panel).getByText(/^Statistical estimate from public registry data\./)).toHaveTextContent(NOTE);
  expect(within(panel).getByRole("link", { name: /see Methods for accuracy/ })).toHaveAttribute("href", "/methods#stop-risk");
});

test("empty panel under disease filter", async () => {
  const f = variant((p) => {
    p.rows[0]!.marks[0]!.dz = ["MG"]; // the stopped trial: MG has a trial but no running one
  });
  stubFetch({ "pipeline.json": f });
  renderPage("/target/cd20?disease=MG");
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  const panel = riskPanel();
  expect(panel).toHaveTextContent("No running trials with an estimate for this disease.");
  expect(panel.textContent).not.toMatch(/NaN|0 of 0|undefined/);
  expect(within(panel).queryByRole("list", { name: "Running trials by estimate" })).not.toBeInTheDocument();
});

test("hides per-trial scores when trials block absent", async () => {
  const risk = readFixture<Record<string, unknown>>("risk.json");
  delete risk.trials;
  stubFetch({ "risk.json": risk });
  renderPage();
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  const panel = riskPanel();
  expect(panel).toHaveTextContent("Median estimate 25% across 7 running trials; typical 20%.");
  expect(within(panel).queryByRole("list", { name: "Running trials by estimate" })).not.toBeInTheDocument();
  expect(within(panel).queryByRole("button", { name: /Main factors/ })).not.toBeInTheDocument();
  expect(within(panel).queryByText(/NCT9/)).not.toBeInTheDocument();
  expect(within(panel).getByRole("link", { name: /see Methods for accuracy/ })).toBeInTheDocument();
});

test("panel absent without risk.json", async () => {
  stubFetch({ "risk.json": 404 });
  renderPage();
  await screen.findByRole("heading", { level: 2, name: /What stopped, and why/ });
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("heading", { name: RISK_H })).not.toBeInTheDocument();
  expect(screen.queryByText(/see Methods for accuracy/)).not.toBeInTheDocument();
});
