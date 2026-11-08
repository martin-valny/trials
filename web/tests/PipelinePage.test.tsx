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
  expect(within(keys).getByText("trials still running").previousSibling).toHaveTextContent("7");
  expect(within(keys).getByText("companies with a running trial").previousSibling).toHaveTextContent("1");
  expect(screen.getByText(/8 of 14 trials test a targeted drug/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "see all in Approaches" })).toHaveAttribute("href", "/approaches");
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
  kickers.forEach((k) => expect(["Rising", "Fading", "Longest run"]).toContain(k));
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
