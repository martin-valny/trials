import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

test("Explore is a disclosure with a two-link menu that closes on Escape and on navigation", async () => {
  stubFetch();
  go("/changes");
  const btn = screen.getByRole("button", { name: /Explore/ });
  expect(btn).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(btn);
  expect(btn).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menuitem", { name: "Trial map" })).toHaveAttribute("href", "/explore");
  expect(screen.getByRole("menuitem", { name: "Mechanism graph" })).toHaveAttribute("href", "/approaches/targeted");
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Trial map" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Mechanism graph" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(btn).toHaveAttribute("aria-expanded", "false");
  expect(btn).toHaveFocus();
  await userEvent.click(btn);
  await userEvent.click(screen.getByRole("menuitem", { name: "Trial map" }));
  expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
});

test("the brand links to the pipeline", () => {
  stubFetch();
  go("/changes");
  expect(screen.getByRole("link", { name: /Trial Radar/ })).toHaveAttribute("href", "/");
});

test("the Explore menu closes when focus tabs away", async () => {
  stubFetch();
  go("/changes");
  const btn = screen.getByRole("button", { name: /Explore/ });
  await userEvent.click(btn);
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  await userEvent.tab();
  expect(btn).toHaveAttribute("aria-expanded", "false");
});
