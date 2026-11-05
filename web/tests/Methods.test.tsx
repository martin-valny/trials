import { screen } from "@testing-library/react";
import { expect, test } from "vitest";
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
