import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, test } from "vitest";
import { TargetPage } from "../src/components/target/TargetPage";
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

test("Show on map link carries every NCT", async () => {
  stubFetch();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const link = screen.getByRole("link", { name: /Show these 8 trials on the map/ });
  const href = link.getAttribute("href")!;
  expect(href.startsWith("/explore?nct=")).toBe(true);
  const q = new URLSearchParams(href.split("?")[1]);
  expect(q.get("nct")!.split(",").sort()).toEqual(
    ["NCT90000001", "NCT90000002", "NCT90000004", "NCT90000005", "NCT90000006", "NCT90000007", "NCT90000008", "NCT90000099"],
  );
  expect(q.get("from")).toBe("CD20");
});
