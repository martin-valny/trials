import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DiligencePage } from "../src/components/diligence/DiligencePage";
import { claimCounts } from "../src/lib/diligence";
import { __resetDiligenceIndex } from "../src/lib/diligenceRelease";
import type { RunRecord } from "../src/types";
import { stubFetch } from "./helpers";

const cd20 = JSON.parse(readFileSync(join(__dirname, "fixtures", "diligence", "cd20__MS.json"), "utf-8")) as RunRecord;
const btk: RunRecord = { ...cd20, target: "btk", run_id: "b1" };
const INDEX = { runs: [{ target: "cd20", disease: "MS" }, { target: "btk", disease: "MS" }] };
const REPORT = {
  citation_validity: 1,
  support_rate: 0.82,
  checker_agreement: null,
  judgement_shown_rate: 0.5,
  cost_usd_mean: 0.214,
  seconds_mean: 61,
  n_runs: 4,
  models: {},
  agent_version: "0.1.0",
  generated_at: "2026-11-09T12:00:00Z",
};

/** Fixture data under /data/, plus the diligence files (BASE_URL is "/" in tests, so their keys keep the slash). */
function serve(diligence: Record<string, unknown | number>) {
  stubFetch(Object.fromEntries(Object.entries(diligence).map(([k, v]) => [`/diligence/${k}`, v])));
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function go() {
  return render(
    <MemoryRouter initialEntries={["/diligence"]}>
      <Routes>
        <Route path="/diligence" element={<DiligencePage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const table = () => screen.findByRole("table", { name: "Recorded memos" });
const bodyRows = (t: HTMLElement) => within(t).getAllByRole("row").slice(1);

beforeEach(() => {
  __resetDiligenceIndex();
  vi.stubEnv("VITE_DILIGENCE_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

test("lists recorded memos", async () => {
  serve({ "index.json": INDEX, "cd20__MS.json": cd20, "btk__MS.json": btk });
  go();
  expect(await screen.findByRole("heading", { level: 1, name: "AI diligence" })).toBeInTheDocument();
  expect(screen.getByText("AI judgement from public data, not investment advice")).toBeInTheDocument();
  const t = await table();
  await waitFor(() => expect(bodyRows(t)).toHaveLength(2));
  const [first, second] = bodyRows(t);
  const { n, m } = claimCounts(cd20);
  expect(first).toHaveTextContent("CD20");
  expect(first).toHaveTextContent("Multiple sclerosis");
  expect(first).toHaveTextContent("mixed");
  expect(first).toHaveTextContent("low confidence");
  expect(first).toHaveTextContent(`${n} of ${m}`);
  expect(first).toHaveTextContent("9 Nov 2026");
  expect(second).toHaveTextContent("BTK");
  expect(within(first!).getByRole("link")).toHaveAttribute("href", "/target/cd20?disease=MS&panel=a");
  expect(within(second!).getByRole("link")).toHaveAttribute("href", "/target/btk?disease=MS&panel=a");
});

test("skips a pair whose memo is missing", async () => {
  serve({ "index.json": INDEX, "cd20__MS.json": cd20, "btk__MS.json": 404 });
  go();
  const t = await table();
  await waitFor(() => expect(bodyRows(t)).toHaveLength(1));
  expect(t).not.toHaveTextContent("BTK");
  expect(screen.queryByText(/error|could not|failed/i)).not.toBeInTheDocument();
});

test("withheld judgement reads withheld", async () => {
  serve({ "index.json": { runs: [INDEX.runs[0]] }, "cd20__MS.json": { ...cd20, judgement_shown: false } });
  go();
  const t = await table();
  await waitFor(() => expect(bodyRows(t)).toHaveLength(1));
  expect(bodyRows(t)[0]).toHaveTextContent("withheld");
  expect(bodyRows(t)[0]).not.toHaveTextContent("mixed");
  expect(bodyRows(t)[0]).not.toHaveTextContent("confidence");
});

test("shows the quality numbers the eval report has", async () => {
  serve({ "index.json": INDEX, "cd20__MS.json": cd20, "btk__MS.json": btk, "eval-report.json": REPORT });
  go();
  const q = await screen.findByRole("region", { name: "How well it does" });
  expect(q).toHaveTextContent("82%");
  expect(q).toHaveTextContent("50%");
  expect(q).toHaveTextContent("$0.21");
  expect(q).not.toHaveTextContent(/checker agreement/i); // null: not shown
  expect(within(q).getByRole("link", { name: "How it is measured →" })).toHaveAttribute("href", "/methods?s=diligence");
});

test("hides quality numbers without eval-report", async () => {
  serve({ "index.json": INDEX, "cd20__MS.json": cd20, "btk__MS.json": btk, "eval-report.json": 404 });
  go();
  await table();
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("region", { name: "How well it does" })).not.toBeInTheDocument();
  expect(screen.queryByText(/support rate/i)).not.toBeInTheDocument();
  // The method is still one link away.
  expect(screen.getByRole("link", { name: /full method/ })).toHaveAttribute("href", "/methods?s=diligence");
});

test("closed sends the visitor to the Methods diligence section", async () => {
  serve({ "index.json": 404 });
  go();
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/methods?s=diligence"));
});

test("no picker in recorded state", async () => {
  serve({ "index.json": INDEX, "cd20__MS.json": cd20, "btk__MS.json": btk });
  go();
  await table();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open memo →" })).not.toBeInTheDocument();
});

test("picker in live state lists every pipeline row", async () => {
  vi.stubEnv("VITE_DILIGENCE_URL", "https://agent.test/");
  serve({ "index.json": INDEX, "cd20__MS.json": cd20, "btk__MS.json": btk });
  const pipeline = JSON.parse(readFileSync(join(__dirname, "fixtures", "data", "pipeline.json"), "utf-8")) as { rows: { label: string }[] };
  go();
  const target = await screen.findByRole("combobox", { name: "Target" });
  await waitFor(() => expect(within(target).getAllByRole("option")).toHaveLength(pipeline.rows.length));
  expect(within(target).getAllByRole("option").map((o) => o.textContent)).toEqual(pipeline.rows.map((r) => r.label));
  const disease = screen.getByRole("combobox", { name: "Disease" });
  expect(within(disease).getAllByRole("option").map((o) => o.textContent)).toEqual(["All diseases", "Multiple sclerosis"]);
  await userEvent.selectOptions(disease, "MS");
  await userEvent.click(screen.getByRole("button", { name: "Open memo →" }));
  expect(screen.getByTestId("where").textContent).toBe("/target/cd20?disease=MS&panel=a");
});
