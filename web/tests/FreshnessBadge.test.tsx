import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FreshnessBadge } from "../src/components/FreshnessBadge";
import type { Meta } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

const meta = readFixture<Meta>("meta.json");

test("badge shows the registry date, with the full times on hover", async () => {
  stubFetch();
  render(<FreshnessBadge now={new Date("2026-11-04T12:00:00Z")} />);
  const badge = await screen.findByText("Registry data from 4 Nov 2026");
  expect(badge).toHaveClass("ok");
  expect(badge).toHaveAttribute("title", expect.stringMatching(/Last updated 2026-11-04 07:19 UTC/));
  expect(screen.queryByText(/may be stale/)).not.toBeInTheDocument();
});

test("badge says how old the data is when stale", async () => {
  stubFetch();
  render(<FreshnessBadge now={new Date("2026-11-07T20:19:00Z")} />);
  const note = await screen.findByText("Registry data from 4 Nov 2026, 3 days old");
  expect(note).toHaveClass("stale");
  expect(note).not.toHaveClass("warn");
  expect(screen.queryByText(/Data may be stale/)).not.toBeInTheDocument();
});

test("stale with no registry date falls back to the last update", async () => {
  stubFetch({ "meta.json": { ...meta, data_timestamp: null } });
  render(<FreshnessBadge now={new Date("2026-11-06T12:00:00Z")} />);
  expect(await screen.findByText("Registry data from 4 Nov 2026, 2 days old")).toBeInTheDocument();
});

test("badge handles missing meta", async () => {
  stubFetch({ "meta.json": 404 });
  render(<FreshnessBadge />);
  expect(await screen.findByText("Freshness unknown")).toBeInTheDocument();
});

test("badge handles a failing request", async () => {
  stubFetch({ "meta.json": 500 });
  render(<FreshnessBadge />);
  expect(await screen.findByText("Freshness unknown")).toBeInTheDocument();
});

test("fixture matches the exported meta shape", () => {
  expect(Object.keys(meta).sort()).toEqual(
    [
      "area",
      "conditions",
      "data_timestamp",
      "generated_for",
      "last_success_at",
      "trial_count",
      "tracking_since",
      "warnings",
    ].sort(),
  );
});


test("null timestamps degrade to unknown instead of crashing", async () => {
  stubFetch({ "meta.json": { ...meta, last_success_at: null, data_timestamp: null } });
  render(<FreshnessBadge />);
  expect(await screen.findByText("Freshness unknown")).toBeInTheDocument();
});

test("missing data timestamp still shows the last update date", async () => {
  stubFetch({ "meta.json": { ...meta, data_timestamp: null } });
  render(<FreshnessBadge now={new Date("2026-11-04T12:00:00Z")} />);
  expect(await screen.findByText("Registry data from 4 Nov 2026")).toBeInTheDocument();
});
