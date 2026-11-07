import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    screen.getByRole("img", {
      name: `3D map of ${explorer.trials.length} trials. Scroll or press + and − to zoom, 0 to reset.`,
    }),
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
      "Dot size: enrollment. Position uses only what a trial studies; outcome is colour only. Scroll to zoom; drag to turn, or to pan when zoomed (Shift-drag turns). Hover for details, click to open.",
    ),
  ).toBeInTheDocument();
});

test("on a coarse pointer the caption says tap to open and never mentions hover", async () => {
  withCanvas();
  stubFetch();
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  renderAt(<Explore />, "/explore");
  const a = await screen.findByRole("region", { name: /Embedding of/ });
  const caption = within(a).getByText(/^Dot size: enrollment\./);
  expect(caption).toHaveTextContent("Pinch to zoom; drag to turn, or to pan when zoomed. Tap to open.");
  expect(caption.textContent).not.toMatch(/hover/i);
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
  // The button is gone with the empty state, so focus goes on to Find rather than falling to the page.
  expect(screen.getByLabelText("Find a trial")).toHaveFocus();
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
  // The name says what a press will do, so it carries no pressed state as well.
  const play = await screen.findByRole("button", { name: "Play rotation" });
  expect(play).not.toHaveAttribute("aria-pressed");
  await userEvent.click(play);
  const pause = screen.getByRole("button", { name: "Pause rotation" });
  expect(pause).not.toHaveAttribute("aria-pressed");
  expect(screen.queryByRole("button", { name: "Play rotation" })).not.toBeInTheDocument();
});

/**
 * findBy* drains with a 0ms timer before it returns; on a loaded machine that timer can fire before
 * React's next scheduler task, i.e. before passive effects have run. Force that order, so a test that
 * acts on the map the moment it appears is deterministic: the map must take input from first paint.
 */
async function findMapBeforeEffects(): Promise<HTMLElement> {
  const real = globalThis.setTimeout;
  vi.stubGlobal("setTimeout", ((fn: () => void, ms?: number) =>
    ms ? real(fn, ms) : (queueMicrotask(fn), 0)) as unknown as typeof setTimeout);
  try {
    return await screen.findByRole("img", { name: /3D map of/ });
  } finally {
    vi.stubGlobal("setTimeout", real);
  }
}

test("Reset view appears once the map is zoomed, and a press returns it to 1x", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const canvas = await findMapBeforeEffects();
  expect(screen.queryByRole("button", { name: "Reset view" })).not.toBeInTheDocument();
  act(() => void canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -300, cancelable: true, bubbles: true })));
  const reset = await screen.findByRole("button", { name: "Reset view" });
  // It sits with Play, in the same quiet text style.
  expect(reset).toHaveClass("plate-control");
  expect(screen.getByRole("button", { name: "Play rotation" })).toHaveClass("plate-control");
  await userEvent.click(reset);
  expect(screen.queryByRole("button", { name: "Reset view" })).not.toBeInTheDocument();
  // The control leaves with the zoom: focus goes to the map, not to the page.
  expect(canvas).toHaveFocus();
});

test("+ zooms and 0 resets while the map has focus", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const canvas = await screen.findByRole("img", { name: /3D map of/ });
  canvas.focus();
  await userEvent.keyboard("+");
  expect(await screen.findByRole("button", { name: "Reset view" })).toBeInTheDocument();
  await userEvent.keyboard("0");
  expect(screen.queryByRole("button", { name: "Reset view" })).not.toBeInTheDocument();
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

test("the hover card draws a 1px leader to the dot's ring", () => {
  const t = explorer.trials[0];
  const { container } = render(
    <div style={{ position: "relative" }}>
      <HoverCard trial={t} x={10} y={10} r={6} />
    </div>,
  );
  const leader = container.querySelector("svg.hover-leader line");
  expect(leader).not.toBeNull();
  expect(container.querySelector("svg.hover-leader")).toHaveAttribute("aria-hidden", "true");
});

test("the hover card is a tooltip with the trial's id, title and facts", () => {
  const t = explorer.trials[0];
  render(<HoverCard trial={t} x={10} y={10} r={6} />);
  const card = screen.getByRole("tooltip");
  expect(card).toHaveTextContent(`${t.nct_id} · ${t.title}`);
  expect(card).toHaveTextContent("dimethyl fumarate · NRF2 activator · Small molecule · Behavioral, Device · Phase 4 · 2015–2016");
});

const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

test("the map controls toolbar comes before the canvas", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const canvas = await screen.findByRole("img", { name: /^3D map of/ });
  const bar = screen.getByRole("group", { name: "Map controls" });
  expect(follows(bar, canvas)).toBe(true);
  expect(within(bar).getByLabelText("Find a trial")).toBeInTheDocument();
  expect(within(bar).getByRole("group", { name: "Colour" })).toBeInTheDocument();
  for (const name of ["Disease: all", "Phase: all", "Outcome: all", "Treatment: all", "Years: all"]) {
    expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
  }
  const withResults = explorer.trials.filter((t) => t.has_results).length;
  expect(within(bar).getByRole("button", { name: `Results posted ${withResults}` })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(within(bar).getByText(`Showing ${explorer.trials.length} of ${explorer.trials.length} trials`)).toBeInTheDocument();
});

test("Select none in Phase empties the map, and Reset filters brings every trial back", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  await userEvent.click(await screen.findByRole("button", { name: "Phase: all" }));
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  expect(screen.getByText("No trials match these filters.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Phase: none" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.queryByText("No trials match these filters.")).not.toBeInTheDocument();
  expect(screen.getByText("Showing 14 of 14 trials")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Phase: all" })).toBeInTheDocument();
});

test("Reset all is disabled until a filter changes, and resets every filter", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const reset = await screen.findByRole("button", { name: "Reset all" });
  expect(reset).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /^Results posted/ }));
  expect(reset).toBeEnabled();
  await userEvent.type(screen.getByLabelText("Find a trial"), "zzz");
  await userEvent.click(reset);
  expect(reset).toBeDisabled();
  expect(screen.getByRole("button", { name: /^Results posted/ })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("Find a trial")).toHaveValue("");
  const n = explorer.trials.length;
  expect(screen.getByText(`Showing ${n} of ${n} trials`)).toBeInTheDocument();
});

test("Reset all hands keyboard focus to the Find field instead of dropping it", async () => {
  withCanvas();
  stubFetch();
  renderAt(<Explore />, "/explore");
  const sw = await screen.findByRole("button", { name: /^Results posted/ });
  await userEvent.click(sw);
  const reset = screen.getByRole("button", { name: "Reset all" });
  reset.focus();
  await userEvent.keyboard("{Enter}");
  expect(reset).toBeDisabled();
  expect(screen.getByLabelText("Find a trial")).toHaveFocus();
});

test("the Labels switch stays under reduced motion, where there is no Play", async () => {
  withCanvas();
  stubFetch();
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  renderAt(<Explore />, "/explore");
  const labels = await screen.findByRole("group", { name: "Labels" });
  expect(within(labels).getByRole("button", { name: "Diseases" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: /rotation/ })).not.toBeInTheDocument();
});
