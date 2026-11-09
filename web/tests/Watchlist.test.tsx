import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, test } from "vitest";
import { WatchlistPage } from "../src/components/watchlist/WatchlistPage";
import type { PipelineFile, RiskFile } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
const renderPage = (route = "/watchlist") =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <WatchlistPage />
      <Where />
    </MemoryRouter>,
  );

const NOTE =
  "Statistical estimate from public registry data. Not a statement about any sponsor or trial. The model is often wrong; see Methods for accuracy.";
const table = () => screen.findByRole("table", { name: /Running trials ranked/ });
const order = () =>
  within(screen.getByRole("table", { name: /Running trials ranked/ }))
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("link")[0]!.textContent);
const where = () => screen.getByTestId("where").textContent ?? "";

const riskVariant = (f: (r: RiskFile) => void): RiskFile => {
  const r = readFixture<RiskFile>("risk.json");
  f(r);
  return r;
};
const pipelineVariant = (f: (p: PipelineFile) => void): PipelineFile => {
  const p = readFixture<PipelineFile>("pipeline.json");
  f(p);
  return p;
};

test("renders ranked rows from the fixture in estimate order, with the note", async () => {
  stubFetch();
  renderPage();
  await table();
  expect(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeInTheDocument();
  expect(screen.getByText("7 running drug trials, ranked by estimated chance of stopping early.")).toBeInTheDocument();
  expect(screen.getByText(/^Statistical estimate from public registry data\./)).toHaveTextContent(NOTE);
  expect(order()).toEqual(["NCT90000004", "NCT90000005", "NCT90000099", "NCT90000002", "NCT90000008", "NCT90000006", "NCT90000007"]);
  const first = screen.getAllByRole("row")[1]!;
  expect(first).toHaveTextContent("65% (53–74)");
  expect(first).toHaveTextContent("above typical 20%");
  expect(first).toHaveTextContent("Phase 2 · Example Pharma");
  expect(within(first).getByRole("img", { name: "Estimated 65% (53–74); typical 20%" })).toBeInTheDocument();
  expect(within(first).getByRole("link", { name: "NCT90000004" })).toHaveAttribute("href", "/trial/NCT90000004");
  expect(within(first).getByRole("link", { name: /ClinicalTrials\.gov/ })).toHaveAttribute(
    "href",
    "https://clinicaltrials.gov/study/NCT90000004",
  );
  expect(within(first).getByRole("link", { name: "CD20" })).toHaveAttribute("href", "/target/cd20");
  expect(first).toHaveTextContent("Multiple sclerosis");
  const factors = within(first).getByRole("list", { name: "Main factors" });
  expect(within(factors).getAllByRole("listitem")).toHaveLength(3);
  expect(factors).toHaveTextContent("Few sites (1)");
});

test("sort switch reorders by difference from typical and is in the URL", async () => {
  const risk = riskVariant((r) => {
    r.trials!.NCT90000004!.typical = 0.6;
    r.trials!.NCT90000005!.typical = 0.6;
    r.trials!.NCT90000099!.typical = 0.05;
  });
  stubFetch({ "risk.json": risk });
  renderPage();
  await table();
  expect(order()[0]).toBe("NCT90000004");
  await userEvent.click(screen.getByRole("button", { name: "Above typical by most" }));
  expect(order()[0]).toBe("NCT90000099");
  expect(where()).toMatch(/sort=difference/);
  expect(screen.getByRole("button", { name: "Above typical by most" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
  expect(order()[0]).toBe("NCT90000004");
  expect(where()).not.toMatch(/sort=/);
});

test("the sort arrives from the URL", async () => {
  const risk = riskVariant((r) => {
    r.trials!.NCT90000099!.typical = 0.05;
    r.trials!.NCT90000004!.typical = 0.6;
    r.trials!.NCT90000005!.typical = 0.6;
  });
  stubFetch({ "risk.json": risk });
  renderPage("/watchlist?sort=difference");
  await table();
  expect(order()[0]).toBe("NCT90000099");
});

test("disease filter narrows and is in the URL", async () => {
  const pipeline = pipelineVariant((p) => {
    p.rows[0]!.marks.find((m) => m.n === "NCT90000099")!.dz = ["MG"];
  });
  stubFetch({ "pipeline.json": pipeline });
  renderPage();
  await table();
  expect(order()).toHaveLength(7);
  await userEvent.click(screen.getByRole("button", { name: /^Disease/ }));
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Myasthenia gravis/ }));
  expect(order()).toEqual(["NCT90000099"]);
  expect(where()).toMatch(/disease=MG/);
  expect(screen.getByText("Showing 1 of 7 trials")).toBeInTheDocument();
});

test("a disease in the URL arrives preselected; target links carry it", async () => {
  const pipeline = pipelineVariant((p) => {
    p.rows[0]!.marks.find((m) => m.n === "NCT90000099")!.dz = ["MG"];
  });
  stubFetch({ "pipeline.json": pipeline });
  renderPage("/watchlist?disease=MS");
  await table();
  expect(order()).not.toContain("NCT90000099");
  expect(order()).toHaveLength(6);
  expect(within(screen.getAllByRole("row")[1]!).getByRole("link", { name: "CD20" })).toHaveAttribute("href", "/target/cd20?disease=MS");
});

test("company filter narrows and is in the URL", async () => {
  stubFetch();
  renderPage("/watchlist?company=Acme%20Biotech");
  expect(await screen.findByText("No running trials match these filters.")).toBeInTheDocument();
  expect(where()).toMatch(/company=Acme/);
});

test('"No target row" filter shows untargeted trials', async () => {
  const risk = riskVariant((r) => {
    r.trials!.NCT02343159 = { ...r.trials!.NCT90000002!, p: 0.3 };
  });
  stubFetch({ "risk.json": risk });
  renderPage();
  await table();
  expect(order()).toHaveLength(8);
  await userEvent.click(screen.getByRole("button", { name: /^Target/ }));
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /No target row/ }));
  expect(order()).toEqual(["NCT02343159"]);
  expect(where()).toMatch(/target=none/);
  const row = screen.getAllByRole("row")[1]!;
  expect(row).toHaveTextContent("No target row");
  expect(row).toHaveTextContent("Biogen");
});

test("hides per-trial scores when trials block absent (target list instead)", async () => {
  const risk = riskVariant((r) => {
    delete r.trials;
  });
  stubFetch({ "risk.json": risk });
  renderPage();
  const list = await screen.findByRole("table", { name: /Targets by median estimate/ });
  expect(screen.queryByText(/NCT9/)).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Main factors" })).not.toBeInTheDocument();
  const rows = within(list).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(1);
  expect(within(rows[0]!).getByRole("link", { name: "CD20" })).toHaveAttribute("href", "/target/cd20");
  expect(rows[0]).toHaveTextContent("25%");
  expect(rows[0]).toHaveTextContent("typical 20%");
  expect(rows[0]).toHaveTextContent("7");
  expect(screen.getByText(/^Statistical estimate from public registry data\./)).toHaveTextContent(NOTE);
});

test("missing risk.json says when estimates appear", async () => {
  stubFetch({ "risk.json": 404 });
  renderPage();
  await screen.findByText("Estimates appear after the next daily update.");
  expect(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("never uses banned wording", async () => {
  stubFetch();
  const { container } = renderPage();
  await table();
  expect(container.textContent).not.toMatch(/risk of failure|likely to fail|in trouble/i);
});
