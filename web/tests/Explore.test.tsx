import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { Explore } from "../src/components/explore/Explore";
import { HoverCard } from "../src/components/explore/HoverCard";
import type { ExplorerFile, Meta } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

const explorer = readFixture<ExplorerFile>("explorer.json");
const meta = readFixture<Meta>("meta.json");

/** A 2D context that accepts every call the renderer makes and draws nothing. */
function fakeContext(): CanvasRenderingContext2D {
  const noop = () => undefined;
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => (key === "canvas" ? undefined : key === "measureText" ? () => ({ width: 0 }) : noop),
    set: () => true,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

const withCanvas = () =>
  vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((() => fakeContext()) as unknown as HTMLCanvasElement["getContext"]);

test("renders figure title from meta area", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const title = await screen.findByRole("heading", { level: 1 });
  expect(title).toHaveTextContent(/^Figure 1 \|/);
  expect(title).toHaveTextContent(meta.area);
  expect(
    screen.getByRole("img", { name: `3D map of ${explorer.trials.length} trials` }),
  ).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`^${explorer.trials.length} trials;`))).toBeInTheDocument();
});

test("panel a carries a caption on how to read the map", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const a = await screen.findByRole("region", { name: /Embedding of/ });
  expect(
    within(a).getByText(
      "Dot size: enrollment. Position uses only what a trial studies; outcome is colour only. Drag to turn, hover for details, click to open.",
    ),
  ).toBeInTheDocument();
});

test("missing explorer shows explanation", async () => {
  withCanvas();
  stubFetch({ "explorer.json": 404 });
  renderAt(<Explore />, "/explore");
  expect(await screen.findByText(/The map appears after the next daily update\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /trial list/i })).toHaveAttribute("href", "/trials");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

test("zero matches shows reset and reset restores", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const box = await screen.findByLabelText("Find a trial");
  await userEvent.type(box, "zzz-no-such-trial");
  expect(screen.getByText("No trials match these filters.")).toBeInTheDocument();
  expect(await screen.findByText(/^0 trials;/, {}, { timeout: 2000 })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.queryByText("No trials match these filters.")).not.toBeInTheDocument();
  expect(box).toHaveValue("");
  const n = explorer.trials.length;
  expect(screen.getByText(`Showing ${n} of ${n} trials`)).toBeInTheDocument();
});

test("canvas fallback when no 2d context", async () => {
  stubFetch();
  // jsdom has no canvas backend: getContext returns null (and logs "not implemented").
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  renderAt(<Explore />, "/explore");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByText(/cannot draw the 3D map/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /trial list/i })).toHaveAttribute("href", "#/trials");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

test("shows a skeleton while loading", () => {
  withCanvas();
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
  renderAt(<Explore />, "/explore");
  expect(screen.getByText("Loading the map…")).toBeInTheDocument();
});

test("a map with no trials says it needs at least 4, not that filters match nothing", async () => {
  withCanvas();
  stubFetch({ "explorer.json": { ...explorer, trials: [] } });
  renderAt(<Explore />, "/explore");
  expect(await screen.findByText("The map needs at least 4 trials in this area.")).toBeInTheDocument();
  expect(screen.queryByText("No trials match these filters.")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reset filters" })).not.toBeInTheDocument();
});

test("the screen-reader summary waits for typing to pause", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const box = await screen.findByLabelText("Find a trial");
  const n = explorer.trials.length;
  const live = screen.getByText(new RegExp(`^${n} trials;`));
  expect(live).toHaveAttribute("aria-live", "polite");
  await userEvent.type(box, "zzz");
  // Right after typing the announcement has not changed yet ...
  expect(live.textContent).toMatch(new RegExp(`^${n} trials;`));
  // ... and it settles about half a second later.
  await waitFor(() => expect(live.textContent).toMatch(/^0 trials;/), { timeout: 2000 });
});

test("the map starts still, with a play control that toggles to pause", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const play = await screen.findByRole("button", { name: "Play rotation" });
  expect(play).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(play);
  const pause = screen.getByRole("button", { name: "Pause rotation" });
  expect(pause).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: "Play rotation" })).not.toBeInTheDocument();
});

test("with reduced motion there is no rotation control", async () => {
  withCanvas();
  stubFetch();
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  renderAt(<Explore />, "/explore");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByRole("button", { name: /rotation/ })).not.toBeInTheDocument();
});

test("the hover card is a tooltip with the trial's id, title and facts", () => {
  const t = explorer.trials[0];
  render(<HoverCard trial={t} x={10} y={10} />);
  const card = screen.getByRole("tooltip");
  expect(card).toHaveTextContent(`${t.nct_id} · ${t.title}`);
  expect(card).toHaveTextContent("dimethyl fumarate · Behavioral, Device · Phase 4 · 2015–2016");
});
