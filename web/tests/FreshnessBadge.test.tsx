import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FreshnessBadge } from "../src/components/FreshnessBadge";
import type { Meta } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

const meta = readFixture<Meta>("meta.json");

test("badge shows last update and data timestamp", async () => {
  stubFetch();
  render(<FreshnessBadge now={new Date("2026-11-04T12:00:00Z")} />);
  expect(await screen.findByText(/Last updated 2026-11-04 07:19 UTC/)).toBeInTheDocument();
  expect(screen.getByText(/registry data as of 2026-11-04 10:00:00/)).toBeInTheDocument();
  expect(screen.queryByText(/may be stale/)).not.toBeInTheDocument();
});

test("badge warns when stale", async () => {
  const last = new Date("2026-11-04T07:19:00Z").getTime();
  stubFetch();
  render(<FreshnessBadge now={new Date(last + 37 * 3600 * 1000)} />);
  // One quiet note, no amber pill: the warning in ink 700, then the registry date, muted.
  const warn = await screen.findByText("Data may be stale.");
  expect(warn.tagName).toBe("STRONG");
  const note = warn.closest(".badge")!;
  expect(note).toHaveClass("stale");
  expect(note).not.toHaveClass("warn");
  expect(note.textContent).toBe("Data may be stale. registry as of 4 Nov 2026");
  // The full timestamps stay available on hover.
  expect(note).toHaveAttribute("title", expect.stringMatching(/Last updated 2026-11-04 07:19 UTC/));
});

test("stale with no registry date falls back to the last update", async () => {
  const last = new Date("2026-11-04T07:19:00Z").getTime();
  stubFetch({ "meta.json": { ...meta, data_timestamp: null } });
  render(<FreshnessBadge now={new Date(last + 37 * 3600 * 1000)} />);
  const warn = await screen.findByText("Data may be stale.");
  expect(warn.closest(".badge")!.textContent).toBe("Data may be stale. last updated 4 Nov 2026");
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

test("missing data timestamp still shows the last update", async () => {
  stubFetch({ "meta.json": { ...meta, data_timestamp: null } });
  render(<FreshnessBadge now={new Date("2026-11-04T12:00:00Z")} />);
  expect(await screen.findByText(/Last updated 2026-11-04 07:19 UTC/)).toBeInTheDocument();
  expect(screen.queryByText(/registry data as of/)).not.toBeInTheDocument();
});
