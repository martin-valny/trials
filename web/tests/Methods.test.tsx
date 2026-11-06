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
  expect(screen.getByText(/1,000 shuffles/)).toBeInTheDocument();
  expect(scroll).toHaveBeenCalled();
});
