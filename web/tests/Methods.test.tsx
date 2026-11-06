import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Methods } from "../src/components/Methods";
import type { Meta } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

test("methods lists conditions from meta and limitations", async () => {
  stubFetch();
  renderAt(<Methods />);
  const meta = readFixture<Meta>("meta.json");
  for (const c of meta.conditions) expect(await screen.findByText(c)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Methods" })).toBeInTheDocument();
  expect(screen.getByText(/Registry data lags/)).toBeInTheDocument();
  expect(screen.getByText(/self-reported/)).toBeInTheDocument();
});

test("methods still renders without meta", async () => {
  stubFetch({ "meta.json": 404 });
  renderAt(<Methods />);
  expect(await screen.findByText(/condition list is unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/self-reported/)).toBeInTheDocument();
});

test("methods has map section with success definition", async () => {
  stubFetch();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const { container } = renderAt(<Methods />, "/methods#map");
  const h = await screen.findByRole("heading", { name: "How the map is made" });
  expect(h.closest("section")).toHaveAttribute("id", "map");
  expect(container.querySelector("#map")).not.toBeNull();
  expect(screen.getByText(/had no Phase 3 or 4 trial before it started/)).toBeInTheDocument();
  expect(screen.getByText(/share any of its drugs/)).toBeInTheDocument();
  expect(screen.getByText(/10,000 shuffles/)).toBeInTheDocument();
  expect(screen.getByText(/below 0\.025/)).toBeInTheDocument();
  expect(screen.getByText(/at least one drug in an experimental arm/)).toBeInTheDocument();
  expect(screen.getByText(/Phase 3-only and Phase 4 trials get no success label/)).toBeInTheDocument();
  expect(
    screen.getByText("Recently completed trials have had little time to move on, so recent years undercount success."),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/successful/i);
  expect(scroll).toHaveBeenCalled();
});

test("scrolls again after meta has loaded", async () => {
  stubFetch();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  renderAt(<Methods />, "/methods#map");
  await screen.findByText(readFixture<Meta>("meta.json").conditions[0]);
  expect(scroll.mock.calls.length).toBeGreaterThanOrEqual(2);
});
