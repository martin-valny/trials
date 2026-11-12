import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { TargetPage } from "../src/components/target/TargetPage";
import { axisStart } from "../src/components/target/TargetTimeline";
import type { PipelineFile, RiskFile } from "../src/types";
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

test("renders the lede for cd20 from the fixture, stating each number once", async () => {
  stubFetch();
  renderPage();
  const h1 = await screen.findByRole("heading", { level: 1 });
  expect(h1).toHaveTextContent("CD20");
  expect(h1).toHaveTextContent("gene MS4A1 · B-cell depletion · antibodies");
  const lede = screen.getByText((_, el) => el?.tagName === "P" && el.classList.contains("tl"));
  expect(lede.textContent).toBe("7 of 8 trials are running, from 1 company or academic group. 0 advanced to a later phase; 1 stopped.");
  // The lede carries the counts, in colour; the key numbers that repeated them are gone (spec section 6).
  expect(screen.queryByRole("group", { name: "Key numbers" })).not.toBeInTheDocument();
  expect(lede.querySelector(".runw")).toHaveTextContent("7 of 8 trials are running");
  expect(lede.querySelector("em")).toHaveTextContent("0 advanced");
  expect(lede.textContent).toMatch(/1 stopped\.$/);
  expect(screen.getByRole("group", { name: "Diseases" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pipeline" })).toHaveAttribute("href", "/");
});

test("panel c's reason chips are pills on a hairline, not tinted boxes (spec section 9)", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  const chips = container.querySelectorAll(".reasons > span");
  expect(chips.length).toBeGreaterThan(0);
  for (const c of chips) expect(c).toHaveClass("reason-pill");
  const css = readFileSync(join(__dirname, "..", "src", "components", "target", "target.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = /\.reason-pill\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toMatch(/border-radius:\s*999px/);
  expect(rule).toMatch(/border:\s*1px solid var\(--rule\)/);
  expect(rule).toMatch(/font-size:\s*var\(--fs-meta\)/);
  expect(rule).not.toMatch(/--pale/);
  expect(css).not.toMatch(/\.reasons span\s*\{[^}]*--pale/);
});

test("below 1100px the disease chips scroll sideways and keep the selected one in view", async () => {
  const f = variant((p) => {
    p.rows[0]!.marks[1]!.dz = ["MG"];
  });
  stubFetch({ "pipeline.json": f });
  const scrollTo = vi.fn();
  const protos = [
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("dzs") ? 600 : 0;
    }),
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("dzs") ? 300 : 0;
    }),
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("on") ? 480 : 0;
    }),
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("dz") ? 60 : 0;
    }),
  ];
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  const realStyle = window.getComputedStyle;
  protos.push(
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const cs = realStyle(el);
      if (el.classList.contains("dzs")) Object.defineProperty(cs, "paddingLeft", { value: "24px" });
      return cs;
    }) as never,
  );
  try {
    renderPage("/target/cd20?disease=MG");
    await screen.findByRole("heading", { level: 1 });
    const group = screen.getByRole("group", { name: "Diseases" });
    // jsdom has no wide viewport: the chips sit under the header, not in the title row.
    expect(group.closest(".thead")).toBeNull();
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(scrollTo.mock.contexts.at(-1)).toBe(group);
    // The chip lands one gutter in: the scroller's own padding-left (24px here), not a hard-coded phone gutter.
    expect((scrollTo.mock.calls.at(-1)![0] as ScrollToOptions).left).toBe(480 - 24);
  } finally {
    for (const s of protos) s.mockRestore();
    delete (Element.prototype as { scrollTo?: unknown }).scrollTo;
  }
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

const phoneMedia = () =>
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: query.includes("max-width: 640px"), addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
  );

async function panelE(route = "/target/cd20", file?: PipelineFile) {
  stubFetch(file ? { "pipeline.json": file } : undefined);
  renderPage(route);
  const h = await screen.findByRole("heading", { name: "CD20 by disease" });
  return h.closest("section") as HTMLElement;
}

test("panel e lists the diseases of CD20 in order, with the ladder", async () => {
  const e = await panelE();
  expect(within(e).getByText("e")).toBeInTheDocument();
  const lines = [...e.querySelectorAll(".dzl")].map((l) => l.querySelector(".nm")?.textContent);
  expect(lines).toEqual(["Multiple sclerosis", "NMOSD", "CIDP"]);
  const ms = e.querySelectorAll(".dzl")[0] as HTMLElement;
  expect(ms).toHaveTextContent("8");
  expect(ms).toHaveTextContent("7 running");
  const bars = [...ms.querySelectorAll(".st i")].map((i) => i.className);
  expect(bars).toEqual(["was", "at", "", ""]);
  expect(within(e).getByText("Approved for this disease")).toBeInTheDocument();
});

test("panel e MS line shows both approved drugs with links and sources", async () => {
  const e = await panelE();
  const ms = e.querySelectorAll(".dzl")[0] as HTMLElement;
  const oc = within(ms).getByRole("link", { name: "ocrelizumab" });
  expect(oc).toHaveAttribute("href", expect.stringContaining("dailymed"));
  expect(oc).toHaveAttribute("target", "_blank");
  expect(oc).toHaveAttribute("rel", "noreferrer");
  expect(within(ms).getByRole("link", { name: "ofatumumab" })).toBeInTheDocument();
  expect(within(ms).getAllByText("ChEMBL · FDA label")).toHaveLength(2);
  expect(ms.querySelector(".apl")).toHaveClass("floored");
});

test("panel e: a disease with no trials still lists its hand approval", async () => {
  const e = await panelE();
  const nm = e.querySelectorAll(".dzl")[1] as HTMLElement;
  expect(nm.querySelector(".tc span")).toHaveTextContent("0");
  expect([...nm.querySelectorAll(".st i")].every((i) => i.className === "")).toBe(true);
  expect(within(nm).getByRole("link", { name: "rituximab" })).toBeInTheDocument();
  expect(within(nm).getByText("PMDA 2022 · hand")).toBeInTheDocument();
});

test("panel e withdrawn tag, no rule", async () => {
  const e = await panelE();
  const cidp = e.querySelectorAll(".dzl")[2] as HTMLElement;
  expect(within(cidp).getByRole("link", { name: "obinutuzumab" })).toBeInTheDocument();
  expect(within(cidp).getByText("withdrawn")).toBeInTheDocument();
  expect(cidp.querySelector(".apl")).not.toHaveClass("floored");
});

test("panel e: a disease with no approvals reads None approved", async () => {
  const f = variant((p) => {
    p.rows[0]!.marks[1]!.dz = ["MG"];
  });
  const e = await panelE("/target/cd20", f);
  const mg = [...e.querySelectorAll(".dzl")].find((l) => l.querySelector(".nm")?.textContent === "Myasthenia gravis") as HTMLElement;
  expect(within(mg).getByText("None approved")).toBeInTheDocument();
});

test("panel e: a file read with zero approvals is not 'not available'", async () => {
  const f = variant((p) => {
    for (const r of p.rows) delete r.ap;
  });
  const e = await panelE("/target/cd20", f);
  expect(within(e).queryByText(/Approval data not available/)).not.toBeInTheDocument();
  expect(within(e).getAllByText("None approved").length).toBeGreaterThan(0);
});

test("?disease=MS marks the MS line only", async () => {
  const e = await panelE("/target/cd20?disease=MS");
  const cur = e.querySelectorAll('[aria-current="true"]');
  expect(cur).toHaveLength(1);
  expect(cur[0]).toHaveTextContent("Multiple sclerosis");
});

test("a file without approval data says so once and has no approval column", async () => {
  const f = variant((p) => {
    for (const r of p.rows) delete r.ap;
    delete p.approvals;
  });
  const e = await panelE("/target/cd20", f);
  expect(within(e).getByText(/Approval data not available/)).toBeInTheDocument();
  expect(within(e).queryByText("None approved")).not.toBeInTheDocument();
  expect(within(e).queryByText("Approved for this disease")).not.toBeInTheDocument();
});

test("panel e on a phone is one block per disease", async () => {
  phoneMedia();
  const e = await panelE();
  const blocks = e.querySelectorAll(".dzp .dzl");
  expect(blocks).toHaveLength(3);
  expect(blocks[0]).toHaveTextContent("8 trials · 7 running");
  expect(within(blocks[0] as HTMLElement).getAllByText("P1").length).toBe(1);
  expect(within(blocks[0] as HTMLElement).getByRole("link", { name: "ocrelizumab" })).toBeInTheDocument();
  expect(e.querySelector(".dzh")).toBeNull();
});

// ---------------------------------------------------------------- f. stop-risk estimates
const RISK_H = "Running trials, estimated chance of stopping early";
const NOTE =
  "Statistical estimate from public registry data. Not a statement about any sponsor or trial. It uses only the trial's design and knows nothing about the drug's results. The model is often wrong; see Methods for accuracy.";
const riskPanel = () => screen.getByRole("region", { name: RISK_H });

test("renders the risk panel with heading and rows", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  const panel = riskPanel();
  expect(within(panel).getByText("f")).toHaveClass("ltr");
  // f follows e ("By disease") on the page
  expect(screen.getByRole("heading", { name: "CD20 by disease" }).compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(panel).toHaveTextContent("CD20 · All diseases · 7 running. Tick = typical for phase 2 drug trials.");
  const rows = within(within(panel).getByRole("list", { name: "Running trials by estimate" })).getAllByRole("listitem");
  expect(rows).toHaveLength(7);
  // Highest estimate first; a near-zero range never reads "(0–0)".
  expect(rows[0]).toHaveTextContent("66% (64–68)");
  expect(rows.find((r) => r.textContent?.includes("NCT90000006"))).toHaveTextContent("<1% (<1–<1)");
  expect(panel.textContent).not.toMatch(/\(0–/);
  const row = rows.find((r) => r.textContent?.includes("NCT90000002"))!;
  // risk.json's drug name (registry casing) over the figure's lower-case name
  expect(row).toHaveTextContent("Example Drug · Phase 2 · Example Pharma");
  expect(row).toHaveTextContent("24% (24–25)");
  expect(row).toHaveTextContent("above typical 20%");
  expect(within(row).getByRole("img", { name: "Estimated 24% (24–25); typical 20%" })).toBeInTheDocument();
  expect(within(row).getByRole("link", { name: "NCT90000002" })).toHaveAttribute("href", "/trial/NCT90000002");
  const more = within(row).getByRole("button", { name: /Main factors/ });
  expect(more).toHaveAttribute("aria-expanded", "false");
  expect(row).not.toHaveTextContent("Sites planned: 1");
  await userEvent.click(more);
  expect(more).toHaveAttribute("aria-expanded", "true");
  const factors = within(row).getByRole("list", { name: "Main factors" });
  expect(within(factors).getAllByRole("listitem")).toHaveLength(3);
  expect(factors).toHaveTextContent("Sites planned: 1");
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
  expect(panel).toHaveTextContent("Median estimate 24% across 7 running trials; typical 20%.");
  expect(within(panel).queryByRole("list", { name: "Running trials by estimate" })).not.toBeInTheDocument();
  expect(within(panel).queryByRole("button", { name: /Main factors/ })).not.toBeInTheDocument();
  expect(within(panel).queryByText(/NCT9/)).not.toBeInTheDocument();
  expect(within(panel).getByRole("link", { name: /see Methods for accuracy/ })).toBeInTheDocument();
});

test("without per-trial scores, a summary of fewer than three trials is not shown", async () => {
  const risk = readFixture<RiskFile>("risk.json");
  delete risk.trials;
  risk.targets!.cd20!.all = { n: 2, median: 0.5, typical: 0.2 };
  stubFetch({ "risk.json": risk });
  renderPage();
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  const panel = riskPanel();
  expect(panel).toHaveTextContent("Too few running trials to summarise.");
  expect(panel).not.toHaveTextContent("50%");
  expect(panel).not.toHaveTextContent(/Median estimate/);
});

test("panel absent without risk.json", async () => {
  stubFetch({ "risk.json": 404 });
  renderPage();
  await screen.findByRole("heading", { level: 2, name: /What stopped, and why/ });
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("heading", { name: RISK_H })).not.toBeInTheDocument();
  expect(screen.queryByText(/see Methods for accuracy/)).not.toBeInTheDocument();
});

test("panel f opens with a claim line counting trials above their typical rate", async () => {
  const risk = readFixture<RiskFile>("risk.json");
  for (const t of Object.values(risk.trials!)) Object.assign(t, { p: 0.2, lo: 0.15, hi: 0.25, typical: 0.2 });
  Object.assign(risk.trials!.NCT90000004!, { p: 0.5, lo: 0.4, hi: 0.6 });
  stubFetch({ "risk.json": risk });
  renderPage();
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  const claim = within(riskPanel()).getByText(/sits? above their phase's typical rate\.$/);
  expect(claim).toHaveTextContent("1 of 7 running CD20 trials sits above their phase's typical rate.");
  expect(claim.compareDocumentPosition(within(riskPanel()).getByText(/^CD20 · All diseases/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("without per-trial scores, a disease whose summary was left out says too few, not none", async () => {
  const risk = readFixture<RiskFile>("risk.json");
  delete risk.trials;
  risk.targets!.cd20!.by_disease = {};
  stubFetch({ "risk.json": risk });
  renderPage("/target/cd20?disease=MS");
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  expect(riskPanel()).toHaveTextContent("Too few running trials to summarise.");
});

// ---------------------------------------------------------------- the contents strip and deep links
const realScroll = Element.prototype.scrollIntoView;
afterEach(() => {
  Element.prototype.scrollIntoView = realScroll;
});
const contents = () => screen.getByRole("navigation", { name: "Panels on this page" });
const letters = () => within(contents()).getAllByRole("link").map((l) => l.querySelector(".cs-l")?.textContent);

test("CD20, all diseases: the strip lists a to g, b's number is the companies panel's line count", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  expect(letters()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  const link = (name: RegExp) => within(contents()).getByRole("link", { name });
  expect(link(/Companies/)).toHaveTextContent(`Companies ${container.querySelectorAll(".co").length}`);
  expect(link(/Stops/)).toHaveTextContent("Stops 1");
  expect(link(/Diseases/)).toHaveTextContent(`Diseases ${container.querySelectorAll(".dzt .dzl").length}`);
  expect(link(/Stop chance/)).toHaveTextContent(/Stop chance \d+ above$/);
  expect(link(/Diligence/).textContent).toMatch(/^g Diligence( recorded \d{1,2} [A-Z][a-z]+| not run| running| offline)?$/);
  for (const l of within(contents()).getAllByRole("link")) {
    const id = l.getAttribute("href")!.match(/panel=([a-g])/)![1];
    expect(document.getElementById(`p${id}`), id).not.toBeNull();
  }
});

test("a disease with no trials on the target lists only e and g", async () => {
  stubFetch();
  renderPage("/target/cd20?disease=MOGAD");
  await screen.findByRole("heading", { level: 1 });
  await screen.findByRole("heading", { level: 2, name: "CD20 by disease" });
  expect(letters()).toEqual(["e", "g"]);
});

test("panel f shows the 8 highest estimates, then all of them on Show all", async () => {
  const f = variant((p) => {
    const base = p.rows[0]!.marks.find((m) => m.n === "NCT90000002")!;
    for (let i = 0; i < 4; i++) p.rows[0]!.marks.push({ ...base, n: `NCT9100001${i}` });
  });
  const risk = readFixture<RiskFile>("risk.json");
  for (let i = 0; i < 4; i++) risk.trials![`NCT9100001${i}`] = { ...risk.trials!.NCT90000002!, p: 0.3 + i / 100 };
  stubFetch({ "pipeline.json": f, "risk.json": risk });
  renderPage();
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  const list = () => within(riskPanel()).getByRole("list", { name: "Running trials by estimate" });
  const rows = () => within(list()).getAllByRole("listitem");
  expect(rows()).toHaveLength(8);
  expect(rows()[0]).toHaveTextContent("66%");
  expect(riskPanel()).toHaveTextContent(/of 11 running CD20 trials/);
  const more = within(riskPanel()).getByRole("button", { name: "Show all 11 running trials" });
  await userEvent.click(more);
  expect(rows()).toHaveLength(11);
  // Focus moves to the first row revealed, not to the page body.
  expect(rows()[8]!.contains(document.activeElement)).toBe(true);
  expect(within(riskPanel()).queryByRole("button", { name: /^Show all/ })).not.toBeInTheDocument();
});

test("panel f with 8 or fewer trials has no Show all", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  expect(within(riskPanel()).queryByRole("button", { name: /^Show all/ })).not.toBeInTheDocument();
});

test("?panel=f on a target without risk data drops the param", async () => {
  stubFetch({ "risk.json": 404 });
  Element.prototype.scrollIntoView = vi.fn();
  renderPage("/target/cd20?disease=MS&panel=f");
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/target\/cd20\?disease=MS$/));
  expect(screen.queryByRole("heading", { level: 2, name: RISK_H })).not.toBeInTheDocument();
});

test("?panel=f scrolls to panel f once it has loaded, and a disease chip keeps the param", async () => {
  const f = variant((p) => {
    p.rows[0]!.marks[1]!.dz = ["MG"];
  });
  stubFetch({ "pipeline.json": f });
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  renderPage("/target/cd20?panel=f");
  await screen.findByRole("heading", { level: 2, name: RISK_H });
  await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
  expect(scroll.mock.contexts[0]).toBe(document.getElementById("pf"));
  await userEvent.click(screen.getByRole("button", { name: /^MG\s*1$/ }));
  expect(screen.getByTestId("where")).toHaveTextContent("/target/cd20?disease=MG&panel=f");
  expect(scroll).toHaveBeenCalledTimes(1);
});

test("capped lists in b, c and f keep their hidden rows in the page, for print", async () => {
  const f = variant((p) => {
    const stop = p.rows[0]!.marks.find((m) => m.s === "stop")!;
    for (let i = 0; i < 8; i++) p.rows[0]!.marks.push({ ...stop, n: `NCT9200001${i}` });
  });
  stubFetch({ "pipeline.json": f });
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  const cards = [...container.querySelectorAll<HTMLElement>(".stop-card")];
  expect(cards).toHaveLength(9);
  expect(cards.filter((c) => c.hidden)).toHaveLength(3);
  await userEvent.click(screen.getByRole("button", { name: "Show all 9" }));
  expect(cards.filter((c) => c.hidden)).toHaveLength(0);
});

/** The body of target.css's `@media (min-width: 1100px)` block, and of its phone block, comments stripped. */
function targetCss() {
  const css = readFileSync(join(__dirname, "..", "src", "components", "target", "target.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (q: string) => new RegExp(`@media \\(${q}\\) \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
  return { wide: block("min-width: 1100px"), phone: block("max-width: 640px") };
}

test("the lede is balanced on a 100ch measure at 1100px and up, and avoids a widow on a phone", () => {
  const { wide, phone } = targetCss();
  const lede = (b: string) => /\.thead \.tl\s*\{([^}]*)\}/.exec(b)?.[1] ?? "";
  expect(lede(wide)).toMatch(/max-width:\s*100ch/);
  expect(lede(wide)).toMatch(/text-wrap:\s*balance/);
  expect(lede(phone)).toMatch(/text-wrap:\s*pretty/);
});
