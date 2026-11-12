import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { AppRoutes } from "../src/App";
import { __resetDiligenceIndex } from "../src/lib/diligenceRelease";
import { stubFetch } from "./helpers";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true })) as unknown as HTMLCanvasElement["getContext"]);
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
beforeEach(() => __resetDiligenceIndex());

const go = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  );

test("/mechanisms/targeted?node=x redirects to /approaches/targeted?node=x", async () => {
  stubFetch();
  go("/mechanisms/targeted?node=x");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toMatch(/^\/approaches\/targeted\?.*node=x/));
});

test("/mechanisms and /approaches land on the targeted graph", async () => {
  stubFetch();
  go("/approaches");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/approaches/targeted"));
});

test("/approaches/unclassified lands on Methods, not-yet-categorised", async () => {
  stubFetch();
  go("/approaches/unclassified");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/methods"));
  expect(await screen.findByRole("heading", { name: "Not yet categorised" })).toBeInTheDocument();
});

test("an unknown route goes to the intro", async () => {
  stubFetch();
  go("/nowhere/at/all");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/clinical trials in/);
});

test("/ renders the intro", async () => {
  stubFetch();
  go("/");
  expect(await screen.findByRole("link", { name: "Open the pipeline →" })).toBeInTheDocument();
});

test("/?view=year lands on /pipeline?view=year", async () => {
  stubFetch();
  go("/?view=year");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/pipeline?view=year"));
});

test("/?view=disease&company=Other%20Co lands on /pipeline with the whole query", async () => {
  stubFetch();
  go("/?view=disease&company=Other%20Co");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/pipeline?view=disease&company=Other%20Co"));
});

test("the nav marks Pipeline as the current page on /pipeline", async () => {
  stubFetch();
  go("/pipeline");
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).getByRole("link", { name: "Pipeline" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "Watchlist" })).not.toHaveAttribute("aria-current");
});

test("/pipeline renders the pipeline figure", async () => {
  stubFetch();
  go("/pipeline");
  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open the pipeline →" })).not.toBeInTheDocument();
});

test("the nav Pipeline link goes to /pipeline", () => {
  stubFetch();
  go("/changes");
  expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Pipeline" })).toHaveAttribute("href", "/pipeline");
});

test("the nav is Pipeline, Watchlist, Approaches, Changes, Trials, Methods: no Explore, no Trial map", () => {
  stubFetch();
  go("/changes");
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).queryByRole("button", { name: /Explore/ })).not.toBeInTheDocument();
  expect(within(nav).queryByText("Trial map")).not.toBeInTheDocument();
  expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Pipeline", "Watchlist", "Approaches", "Changes", "Trials", "Methods"]);
});

test("/explore still renders the map for old bookmarks", async () => {
  stubFetch();
  go("/explore?nct=NCT90000001&from=old");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/explore?nct=NCT90000001&from=old"));
  expect(await screen.findByText(/similar trials sit close together/)).toBeInTheDocument();
});

test("the brand links to the intro", () => {
  stubFetch();
  go("/changes");
  expect(screen.getByRole("link", { name: /Trial Radar/ })).toHaveAttribute("href", "/");
});

test("/watchlist renders the Watchlist", async () => {
  stubFetch();
  go("/watchlist");
  await screen.findByRole("table", { name: /Running trials ranked/ });
  expect(screen.getByRole("heading", { level: 1, name: "Watchlist" })).toBeInTheDocument();
  expect(screen.getByTestId("where").textContent).toBe("/watchlist");
});

const OPEN_INDEX = { "/diligence/index.json": { runs: [{ target: "cd20", disease: "MS" }] } };

test("nav order when open", async () => {
  stubFetch(OPEN_INDEX);
  go("/changes");
  const nav = screen.getByRole("navigation", { name: "Main" });
  await waitFor(() =>
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Pipeline",
      "Diligence",
      "Watchlist",
      "Approaches",
      "Changes",
      "Trials",
      "Methods",
    ]),
  );
  expect(within(nav).getByRole("link", { name: "Diligence" })).toHaveAttribute("href", "/diligence");
});

test("nav has no Diligence item when closed", async () => {
  const fetch = stubFetch();
  go("/changes");
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).endsWith("diligence/index.json"))).toBe(true));
  await new Promise((r) => setTimeout(r, 20));
  expect(within(screen.getByRole("navigation", { name: "Main" })).queryByRole("link", { name: "Diligence" })).not.toBeInTheDocument();
});

test("closed redirects to methods", async () => {
  stubFetch();
  go("/diligence");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/methods?s=diligence"));
  expect(await screen.findByRole("heading", { level: 1, name: "Methods" })).toBeInTheDocument();
});

test("/diligence renders the Diligence page when memos are recorded", async () => {
  stubFetch(OPEN_INDEX);
  go("/diligence");
  expect(await screen.findByRole("heading", { level: 1, name: "AI diligence" })).toBeInTheDocument();
  expect(screen.getByTestId("where").textContent).toBe("/diligence");
});
