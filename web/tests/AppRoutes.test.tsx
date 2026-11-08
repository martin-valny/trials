import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, test } from "vitest";
import { AppRoutes } from "../src/App";
import { stubFetch } from "./helpers";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
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

test("an unknown route goes to the pipeline", async () => {
  stubFetch();
  go("/nowhere/at/all");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
});

test("the nav is Pipeline, Approaches, Changes, Trials, Methods: no Explore, no Trial map", () => {
  stubFetch();
  go("/changes");
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).queryByRole("button", { name: /Explore/ })).not.toBeInTheDocument();
  expect(within(nav).queryByText("Trial map")).not.toBeInTheDocument();
  expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Pipeline", "Approaches", "Changes", "Trials", "Methods"]);
});

test("/explore still renders the map for old bookmarks", async () => {
  stubFetch();
  go("/explore?nct=NCT90000001&from=old");
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/explore?nct=NCT90000001&from=old"));
  expect(await screen.findByText(/similar trials sit close together/)).toBeInTheDocument();
});

test("the brand links to the pipeline", () => {
  stubFetch();
  go("/changes");
  expect(screen.getByRole("link", { name: /Trial Radar/ })).toHaveAttribute("href", "/");
});
