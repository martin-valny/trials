import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { PipelinePage } from "../src/components/pipeline/PipelinePage";
import type { PipelineFile } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderPage(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<PipelinePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const where = () => screen.getAllByTestId("where").map((e) => e.textContent).join("|");

test("renders headline, key numbers and source line from the fixture", async () => {
  stubFetch();
  renderPage();
  const h1 = await screen.findByRole("heading", { level: 1 });
  expect(h1.textContent).toBe("7 targeted-drug trials are running. B-cell depletion leads, with 7 of them; CD20 alone has 7.");
  const keys = screen.getByLabelText("Key numbers");
  // The headline states the running count, so the keys carry only what it does not: advanced and companies.
  expect([...keys.querySelectorAll(".key span")].map((e) => e.textContent)).toEqual(["advanced to a later phase", "companies with a running trial"]);
  expect(within(keys).queryByText("trials still running")).not.toBeInTheDocument();
  expect(within(keys).getByText("companies with a running trial").previousSibling).toHaveTextContent("1");
});

test("front door: the source above the figure is one sentence linking to how rows are built", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  const src = container.querySelector(".pipeline > p.source:not(.dg-line)")!;
  expect(src.textContent).toBe("8 of 14 trials test a targeted drug in this class. Registered trials only. How rows are built →");
  expect(within(src as HTMLElement).getByRole("link", { name: "How rows are built →" })).toHaveAttribute("href", "/methods#rows-and-companies");
  // On desktop it sits above the figure, with the diligence line directly under it.
  expect(src.nextElementSibling).toHaveClass("dg-line");
  expect(src.compareDocumentPosition(container.querySelector(".fig-body")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("front door: the full source text moves to the footer, above the advanced line", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  const foot = container.querySelector("footer.foot")!;
  const full = foot.firstElementChild!;
  expect(full.textContent).toMatch(/^8 of 14 trials test a targeted drug in one of these \d+ classes?; 1 more targeted-drug trials sit in smaller classes/);
  expect(full.textContent).toContain("ClinicalTrials.gov registered trials only: no preclinical programmes, company pipeline disclosures or EU-only trials.");
  expect(within(full as HTMLElement).getByRole("link", { name: "see all in Approaches" })).toHaveAttribute("href", "/approaches");
  expect(full.nextElementSibling!.textContent).toMatch(/^.Advanced. means the drug has a later-phase trial/);
  // Nothing above the figure repeats the long caveat.
  expect(container.querySelectorAll(".pipeline > p.source")).toHaveLength(2);
  expect(screen.getAllByText(/ClinicalTrials\.gov registered trials only/)).toHaveLength(1);
});

test("front door on a phone: the source and diligence lines follow the figure", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  try {
    stubFetch();
    const { container } = renderPage();
    await screen.findByRole("heading", { level: 1 });
    const src = await screen.findByText(/^8 of 14 trials test a targeted drug in this class\./);
    const fig = container.querySelector(".fig-body")!;
    expect(fig.compareDocumentPosition(src) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(src.nextElementSibling).toHaveClass("dg-line");
    expect(src.nextElementSibling!.nextElementSibling).toHaveClass("foot");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("on desktop the legend sits inside the controls, after the sort", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  const legend = screen.getByRole("group", { name: "Legend" });
  expect(legend.parentElement).toHaveClass("controls");
  expect(legend.previousElementSibling).toHaveClass("sortby");
  expect(container.querySelector(".controls .ctl-break")).not.toBeNull();
});

test("disease switch updates the URL and the headline", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "MS" }));
  expect(where()).toContain("/?disease=MS");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("running in MS.");
});

test("clicking a company name turns on the lens, and the x clears it", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByText("Most crowded")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Example Pharma" }));
  expect(where()).toContain("company=Example+Pharma");
  expect(screen.getByRole("button", { name: "Clear company lens" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Example Pharma: 7 trials across 1 target class/);
  expect(screen.queryByText("Most crowded")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Clear company lens" }));
  expect(where()).not.toContain("company=");
  expect(screen.getByText("Most crowded")).toBeInTheDocument();
});

test("arrangement switch shows six disease columns and hides the disease control", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByRole("group", { name: "Disease" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "By disease" }));
  expect(where()).toContain("view=disease");
  const cols = [...container.querySelectorAll("[data-col]")].map((e) => e.getAttribute("data-col"));
  expect(cols).toEqual(["MS", "MG", "NMOSD", "CIDP", "MOGAD", "AE"]);
  expect(screen.queryByRole("group", { name: "Disease" })).not.toBeInTheDocument();
  // an empty cell is a quiet dot with its tooltip text
  expect(container.querySelectorAll("[data-empty]").length).toBe(5);
});

test("row link goes to /target/cd20 and keeps ?disease", async () => {
  stubFetch();
  renderPage();
  const link = await screen.findByRole("link", { name: /^CD20: 8 trials/ });
  expect(link).toHaveAttribute("href", "/target/cd20");
  await userEvent.click(screen.getByRole("button", { name: "MS" }));
  expect(screen.getByRole("link", { name: /^CD20: 8 trials/ })).toHaveAttribute("href", "/target/cd20?disease=MS");
  await userEvent.click(screen.getByRole("link", { name: /^CD20: 8 trials/ }));
  expect(where()).toContain("/target/cd20?disease=MS");
});

test("mark click opens the trial card and does not navigate", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  await userEvent.click(container.querySelector('[data-n="NCT90000002"]')!);
  const card = screen.getByRole("dialog", { name: /NCT90000002/ });
  expect(within(card).getByRole("link", { name: "Open trial page" })).toHaveAttribute("href", "/trial/NCT90000002");
  expect(where()).not.toContain("/target");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("renders the empty lens state", async () => {
  stubFetch();
  renderPage("/?disease=MG&company=Acme%20Biotech");
  const clear = await screen.findByRole("button", { name: /Clear the company lens/ });
  expect(clear.closest("p")!.textContent).toBe("Nothing for Acme Biotech in MG. Clear the company lens →");
  await userEvent.click(clear);
  expect(where()).not.toContain("company=");
});

test("renders the unavailable state when pipeline.json is missing", async () => {
  stubFetch({ "pipeline.json": 404 });
  renderPage();
  expect(await screen.findByText("The pipeline figure isn't available for this data refresh")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Trial map" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Trials" })).toHaveAttribute("href", "/trials");
});

test("unknown URL values fall back to the defaults", async () => {
  stubFetch();
  renderPage("/?disease=XYZ&company=Nobody&sort=foo&view=zzz");
  expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("7 targeted-drug trials are running.");
});

test("every row has an accessible name", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  const rows = container.querySelectorAll("[data-row]");
  expect(rows.length).toBeGreaterThan(0);
  rows.forEach((r) => {
    const link = within(r as HTMLElement).getByRole("link");
    expect(link.getAttribute("aria-label")).toMatch(/: \d+ trials, \d+ running, \d+ advanced, \d+ stopped\. Open target page\.$/);
  });
});

/** The fixture with a second row that only Example Pharma is in, so the Acme Biotech lens misses it. */
function withOtherRow(): PipelineFile {
  const f = readFixture<PipelineFile>("pipeline.json");
  const m = f.rows[0]!.marks[1]!;
  f.rows.find((r) => r.id === "cd19")!.marks.push({ ...m, n: "NCT90000555" });
  return f;
}

test("on a phone the company lens hides the rows without the company behind a toggle", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  try {
    stubFetch({ "pipeline.json": withOtherRow() });
    const { container } = renderPage("/?company=Acme%20Biotech");
    const toggle = await screen.findByRole("button", { name: /^Show \d+ other rows?$/ });
    expect(container.querySelectorAll(".prow.miss")).toHaveLength(0);
    await userEvent.click(toggle);
    expect(container.querySelectorAll(".prow.miss").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Hide the other rows" })).toHaveAttribute("aria-expanded", "true");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("on desktop the lens fades the other rows and offers no toggle", async () => {
  stubFetch({ "pipeline.json": withOtherRow() });
  const { container } = renderPage("/?company=Acme%20Biotech");
  await screen.findByRole("button", { name: "Clear company lens" });
  expect(container.querySelectorAll(".row.miss").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /other rows?$/ })).not.toBeInTheDocument();
});

test("By year: the switch sets view=year and draws start-year bins from 2000", async () => {
  stubFetch();
  const { container } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "By year" }));
  expect(where()).toContain("view=year");
  const cols = [...container.querySelectorAll(".grid-head [data-col]")].map((e) => e.textContent);
  expect(cols[0]).toBe("≤2001");
  const ticks = [...container.querySelectorAll(".grid-head [data-tick]")].map((e) => e.textContent);
  expect(ticks).toEqual(["≤2001", "2005", "2010", "2015", "2020", "2025"]);
  expect(cols.length).toBeGreaterThan(10);
  // the disease control stays, and every trial lands in a bin
  expect(screen.getByRole("group", { name: "Disease" })).toBeInTheDocument();
  expect(container.querySelectorAll(".cell .m").length).toBe(8);
  expect(container.querySelector(".asof")).not.toBeNull();
});

test("By year: notes follow the thresholds and never crash on the fixture", async () => {
  stubFetch();
  const { container } = renderPage("/?view=year");
  await screen.findByRole("heading", { level: 1 });
  const kickers = [...container.querySelectorAll(".note .nk")].map((e) => e.textContent);
  expect(kickers).toEqual(["Rising"]);
  expect(container.querySelector(".note")!.textContent).toMatch(/Rising\d+ of \d+ trials started since \d{4}\./);
});

test("By year with an empty disease shows the calm empty state", async () => {
  stubFetch();
  renderPage("/?view=year&disease=AE");
  const btn = await screen.findByRole("button", { name: /Show all diseases/ });
  expect(btn.closest("p")!.textContent).toBe("No targeted-drug trials in AE. Show all diseases →");
});

test("By year on a phone uses 3-year bins", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  try {
    stubFetch();
    const { container } = renderPage("/?view=year");
    await screen.findByRole("heading", { level: 1 });
    const labels = [...container.querySelectorAll(".pcol span")].map((e) => e.textContent);
    expect(labels[0]).toBe("≤2002");
    expect(labels.filter(Boolean)).toEqual(["≤2002", "2005", "2010", "2015", "2020", "2025"]);
    expect(container.querySelector(".strip .cell[data-cell='1']")).not.toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("By year source line counts trials without a start year", async () => {
  const f = readFixture<PipelineFile>("pipeline.json");
  f.rows[0]!.marks[0]!.y = null;
  stubFetch({ "pipeline.json": f });
  renderPage("/?view=year");
  expect(await screen.findByText(/1 trial without a start year is not drawn\./)).toBeInTheDocument();
});

test("By disease: an approved cell has the floor rule and accessible text; withdrawn-only has none", async () => {
  stubFetch();
  const { container } = renderPage("/?view=disease");
  await screen.findByRole("heading", { level: 1 });
  const ms = container.querySelector('[data-row="cd20"] [data-cell="MS"]')!;
  expect(ms).toHaveClass("ap");
  expect(ms.querySelector(".floor")).toHaveAttribute("aria-hidden", "true");
  expect(ms).toHaveTextContent("Approved for Multiple sclerosis: ocrelizumab, ofatumumab.");
  expect(ms.querySelector(".floor")).not.toHaveAttribute("title");
  const nmosd = container.querySelector('[data-row="cd20"] [data-cell="NMOSD"]')!;
  expect(nmosd.querySelector(".floor")).not.toBeNull();
  expect(nmosd.querySelector(".nodot")).not.toBeNull();
  expect(container.querySelector('[data-row="cd20"] [data-cell="CIDP"] .floor')).toBeNull();
  expect(container.querySelector('.p-legend [data-key="approved"]')).toHaveTextContent(
    "a drug on this target is approved for this disease",
  );
});

test("By phase and By year draw no floor rule and no approved legend item", async () => {
  stubFetch();
  for (const route of ["/", "/?view=year"]) {
    const { container, unmount } = renderPage(route);
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelector(".floor")).toBeNull();
    expect(container.querySelector('[data-key="approved"]')).toBeNull();
    unmount();
  }
});

test("the lens dimming selectors exclude the floor rule", () => {
  // jsdom applies no stylesheet, so read the CSS text: every rule that sets the lens .45 dimming must not reach .floor.
  const css = readFileSync(resolve(__dirname, "../src/components/pipeline/pipeline.css"), "utf8");
  const rules = [...css.matchAll(/([^{}]*\.lensed[^{}]*)\{[^}]*opacity:\s*\.45[^}]*\}/g)];
  expect(rules.length).toBe(1);
  const selectors = rules[0]![1]!.split(",").map((x) => x.trim());
  for (const sel of selectors) {
    // A selector that targets a cell as a whole would dim its floor; those must be cell-excluding or floor-excluding.
    expect(sel).not.toMatch(/\.cell\s*$/);
    expect(/:not\(\.floor\)|:not\(\.cell\)|:not\(\.strip\)/.test(sel)).toBe(true);
  }
  expect(selectors.filter((s) => s.includes(":not(.floor)"))).toHaveLength(2);
});

test("the historical dimming selectors exclude the floor rule", () => {
  const css = readFileSync(resolve(__dirname, "../src/components/pipeline/pipeline.css"), "utf8");
  const rules = [...css.matchAll(/([^{}]*\.hist[^{}]*)\{[^}]*opacity:\s*\.62[^}]*\}/g)];
  expect(rules.length).toBe(1);
  const selectors = rules[0]![1]!.split(",").map((x) => x.trim());
  for (const sel of selectors) {
    expect(sel).not.toMatch(/\.cell\s*$/);
    expect(/:not\(\.floor\)|:not\(\.cell\)|:not\(\.strip\)/.test(sel)).toBe(true);
  }
  expect(selectors.filter((s) => s.includes(":not(.floor)"))).toHaveLength(2);
});

test("on a phone the strip shows the floor rule in the same cell", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  try {
    stubFetch();
    const { container } = renderPage("/?view=disease");
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelector(".pstrip")).not.toBeNull();
    expect(container.querySelector('.prow[data-row="cd20"] [data-cell="MS"].ap .floor')).not.toBeNull();
    expect(container.querySelector('.prow[data-row="cd20"] [data-cell="CIDP"] .floor')).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("hovering the floor rule shows the figure's tooltip with the approval sentence", async () => {
  stubFetch();
  const { container } = renderPage("/?view=disease");
  await screen.findByRole("heading", { level: 1 });
  const floor = container.querySelector('[data-row="cd20"] [data-cell="MS"] .floor')!;
  await userEvent.hover(floor);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Approved for Multiple sclerosis: ocrelizumab, ofatumumab.");
  await userEvent.unhover(floor);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("the phone strip's floor is not interactive", () => {
  const css = readFileSync(resolve(__dirname, "../src/components/pipeline/pipeline.css"), "utf8");
  expect(css).toMatch(/\.prow \.strip \.cell \.floor \{ pointer-events: none; \}/);
});

test("the ladder colour is a token with a dark value, not a hard-coded hex in target.css", () => {
  const pipe = readFileSync(resolve(__dirname, "../src/plate.css"), "utf8");
  const target = readFileSync(resolve(__dirname, "../src/components/target/target.css"), "utf8");
  expect([...pipe.matchAll(/--ladder:/g)]).toHaveLength(2);
  expect(target).toMatch(/\.dzl \.st i \{[^}]*var\(--ladder\)/);
  expect(target).not.toMatch(/#3d4147/);
});

test("front door: without a recorded example the diligence line points to how it works", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const line = await screen.findByText(/An AI agent drafts a checked diligence memo on each target page\./);
  expect(line.textContent).toBe("An AI agent drafts a checked diligence memo on each target page. How it works →");
  expect(within(line).getByRole("link", { name: "How it works →" })).toHaveAttribute("href", "/methods#diligence");
  expect(line.textContent).not.toMatch(/New:/);
});

test("front door: with the example recorded, the line links to it in panel g", async () => {
  const rec = JSON.parse(readFileSync(resolve(__dirname, "fixtures", "diligence", "cd20__MS.json"), "utf-8")) as unknown;
  stubFetch({ "/diligence/cd20__MS.json": rec });
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const link = await screen.findByRole("link", { name: "See an example: CD20 in MS →" });
  expect(link).toHaveAttribute("href", "/target/cd20?disease=MS&panel=g");
  expect(link.parentElement!.textContent).toBe("An AI agent drafts a checked diligence memo on each target page. See an example: CD20 in MS →");
});

test("the front-door legend has its own class, so explore.css's .legend and the pipeline's never match each other", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const legend = screen.getByRole("group", { name: "Legend" });
  expect(legend).toHaveClass("p-legend");
  expect(legend).not.toHaveClass("legend");
  const css = readFileSync(resolve(__dirname, "../src/components/pipeline/pipeline.css"), "utf8");
  expect(css).not.toMatch(/\.legend\b/);
});

test("on a phone the kicker line is dropped; desktop keeps it", () => {
  const css = readFileSync(resolve(__dirname, "../src/components/pipeline/pipeline.css"), "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
  expect(phone.slice(0, phone.indexOf("\n}\n"))).toMatch(/\.kicker \{ display: none; \}/);
  expect(css).not.toMatch(/k-run/);
});
