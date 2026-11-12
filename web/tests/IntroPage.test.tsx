import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IntroPage } from "../src/components/intro/IntroPage";
import { __resetDiligenceIndex } from "../src/lib/diligenceRelease";
import { stubFetch } from "./helpers";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
const OPEN_INDEX = { "/diligence/index.json": { runs: [{ target: "cd20", disease: "MS" }] } };
const show = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <IntroPage />
      <Where />
    </MemoryRouter>,
  );
const phoneOn = () => vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width"), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));

beforeEach(() => {
  __resetDiligenceIndex();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true })) as unknown as HTMLCanvasElement["getContext"]);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("headline shows the trial count and the area label", async () => {
  stubFetch(OPEN_INDEX);
  show();
  const h1 = await screen.findByRole("heading", { level: 1 });
  expect(h1).toHaveTextContent("14 clinical trials in MS and autoimmune neurology. Six ways to look at them.");
  expect(screen.queryByText(/rebuilt every morning/i)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the pipeline →" })).toHaveAttribute("href", "/pipeline");
});

test("six lettered items when a memo is recorded", async () => {
  stubFetch(OPEN_INDEX);
  show();
  const list = await screen.findByRole("list", { name: "The views" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
  const rows = within(list).getAllByRole("listitem").map((li) => [li.querySelector("em")?.textContent, li.querySelector(".nm")?.textContent]);
  expect(rows).toEqual([["a", "Pipeline"], ["b", "Diligence"], ["c", "Watchlist"], ["d", "Approaches"], ["e", "Changes"], ["f", "Trials"]]);
});

test("five items a-e and no Diligence when closed; headline says Five", async () => {
  stubFetch();
  show();
  const list = await screen.findByRole("list", { name: "The views" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(5));
  expect(within(list).queryByText("Diligence")).not.toBeInTheDocument();
  expect(within(list).getByText("e")).toBeInTheDocument();
  expect(within(list).queryByText("f")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Five ways to look at them."));
});

test("hovering Watchlist sets the caption; leaving the list releases", async () => {
  stubFetch(OPEN_INDEX);
  show();
  const list = await screen.findByRole("list", { name: "The views" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
  fireEvent.mouseEnter(within(list).getByRole("button", { name: /Watchlist/ }));
  expect(screen.getByText(/Running trials by their estimated chance of stopping early/)).toBeInTheDocument();
  expect(screen.getByText(/c Watchlist\./)).toBeInTheDocument();
  expect(screen.queryByText(/Touring the/)).not.toBeInTheDocument();
  fireEvent.mouseLeave(list);
  expect(screen.getByText("Touring the six views · hover one to hold it")).toBeInTheDocument();
});

test("the all-trials caption links to the map", async () => {
  stubFetch(OPEN_INDEX);
  show();
  expect(await screen.findByRole("link", { name: "Explore the map →" })).toHaveAttribute("href", "/explore");
});

test("clicking Approaches goes to /approaches", async () => {
  stubFetch(OPEN_INDEX);
  show();
  const list = await screen.findByRole("list", { name: "The views" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
  fireEvent.click(within(list).getByRole("button", { name: /Approaches/ }));
  expect(screen.getByTestId("where").textContent).toBe("/approaches");
});

test("each view has its own key", async () => {
  stubFetch(OPEN_INDEX);
  show();
  const list = await screen.findByRole("list", { name: "The views" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
  expect(screen.getByText("moved on")).toBeInTheDocument();
  fireEvent.mouseEnter(within(list).getByRole("button", { name: /Approaches/ }));
  expect(screen.getByText("More than one approach")).toBeInTheDocument();
  expect(screen.getByText("Broad immunomodulators")).toBeInTheDocument();
  fireEvent.mouseEnter(within(list).getByRole("button", { name: /Changes/ }));
  expect(screen.getByText("notable")).toBeInTheDocument();
  fireEvent.mouseEnter(within(list).getByRole("button", { name: /Watchlist/ }));
  expect(screen.getByText("typical rate")).toBeInTheDocument();
});

test("without intro.json the overview message shows, headline and list stay", async () => {
  stubFetch({ ...OPEN_INDEX, "intro.json": 404 });
  show();
  expect(await screen.findByText("The overview appears after the next daily update.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("14 clinical trials");
  expect(screen.getByRole("list", { name: "The views" })).toBeInTheDocument();
});

test("a server error on intro.json shows the same message", async () => {
  stubFetch({ "intro.json": 500 });
  show();
  expect(await screen.findByText("The overview appears after the next daily update.")).toBeInTheDocument();
});

test("phone: first tap holds and offers an Open link, a tap on the active pill navigates", async () => {
  phoneOn();
  stubFetch(OPEN_INDEX);
  show();
  const list = await screen.findByRole("list", { name: "The views" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
  const pill = within(list).getByRole("button", { name: /Watchlist/ });
  fireEvent.click(pill);
  expect(screen.getByTestId("where").textContent).toBe("/");
  expect(screen.getByRole("link", { name: "Open Watchlist →" })).toHaveAttribute("href", "/watchlist");
  expect(screen.queryByText(/Touring/)).not.toBeInTheDocument();
  fireEvent.click(pill);
  expect(screen.getByTestId("where").textContent).toBe("/watchlist");
});

test("the phone layout follows the 760px query, not the site-wide 640px", async () => {
  const asked: string[] = [];
  vi.stubGlobal("matchMedia", (q: string) => {
    asked.push(q);
    return { matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
  stubFetch(OPEN_INDEX);
  show();
  await screen.findByRole("list", { name: "The views" });
  expect(asked).toContain("(max-width: 760px)");
  expect(asked).not.toContain("(max-width: 640px)");
});

test("the Pipeline caption says Orange in dark and Red in light", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("prefers-color-scheme: dark"), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  stubFetch(OPEN_INDEX);
  show();
  const list = await screen.findByRole("list", { name: "The views" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
  fireEvent.mouseEnter(within(list).getByRole("button", { name: /Pipeline/ }));
  expect(screen.getByText(/Orange ones moved on to the next phase/)).toBeInTheDocument();
  expect(screen.queryByText(/Red ones moved on/)).not.toBeInTheDocument();
});

test("the approaches note is a line of the key, not canvas text", async () => {
  stubFetch(OPEN_INDEX);
  show();
  const list = await screen.findByRole("list", { name: "The views" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(6));
  fireEvent.mouseEnter(within(list).getByRole("button", { name: /Approaches/ }));
  expect(screen.getByText(/Trials in several approaches are under More than one/)).toBeInTheDocument();
});
