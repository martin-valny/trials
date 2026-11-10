import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ContentsStrip, type ContentsItem } from "../src/components/ContentsStrip";

const ITEMS: ContentsItem[] = [
  { id: "pa", letter: "a", name: "Timeline" },
  { id: "pb", letter: "b", name: "Companies", count: "7" },
  { id: "pf", letter: "f", name: "Stop chance", count: "15 above" },
  { id: "pg", letter: "g", name: "Diligence", count: "not run" },
];

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.search}</p>;
}

function renderStrip(route = "/target/cd20", items = ITEMS) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ContentsStrip items={items} label="Panels on this page" />
      {items.map((i) => (
        <h2 key={i.id} id={i.id} tabIndex={-1}>
          {i.name}
        </h2>
      ))}
      <Where />
    </MemoryRouter>,
  );
}

const realScroll = Element.prototype.scrollIntoView;
let scroll: ReturnType<typeof vi.fn>;
beforeEach(() => {
  scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll as unknown as typeof realScroll;
});
afterEach(() => {
  Element.prototype.scrollIntoView = realScroll;
});

test("a nav named by its label with one link per item, in order", () => {
  renderStrip();
  const nav = screen.getByRole("navigation", { name: "Panels on this page" });
  const links = within(nav).getAllByRole("link");
  expect(links.map((l) => l.textContent)).toEqual(["a Timeline", "b Companies 7", "f Stop chance 15 above", "g Diligence not run"]);
});

test("clicking f scrolls to #pf, focuses it and sets ?panel=f", async () => {
  renderStrip("/target/cd20?disease=MS");
  await userEvent.click(screen.getByRole("link", { name: /Stop chance/ }));
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.contexts[0]).toBe(document.getElementById("pf"));
  expect(document.activeElement).toBe(document.getElementById("pf"));
  expect(screen.getByTestId("where")).toHaveTextContent("?disease=MS&panel=f");
});

test("?panel=zz with no #pzz drops the param and does not scroll", () => {
  renderStrip("/target/cd20?panel=zz");
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByTestId("where").textContent).toBe("");
});

test("?panel=f on load scrolls to #pf once, without moving focus there", () => {
  renderStrip("/target/cd20?panel=f");
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.contexts[0]).toBe(document.getElementById("pf"));
  expect(document.activeElement).not.toBe(document.getElementById("pf"));
  expect(screen.getByTestId("where")).toHaveTextContent("?panel=f");
});

test("under reduced motion the scroll is not smooth", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes(": reduce"),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  renderStrip();
  await userEvent.click(screen.getByRole("link", { name: /Diligence/ }));
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
});

test("with motion allowed the scroll is smooth", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("no-preference"),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  renderStrip();
  await userEvent.click(screen.getByRole("link", { name: /Diligence/ }));
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
});

test("a clicked panel stays current while the smooth scroll is still on its way, at the foot of the page", async () => {
  // A page whose foot shows g: f starts far above the view, and only reaches its place when the scroll settles.
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("innerHeight", 800);
  const tops: Record<string, number> = { pa: -3000, pb: -2400, pf: -900, pg: 500 };
  const realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const t = tops[this.id] ?? 0;
    return { top: t, bottom: t + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: t, toJSON: () => ({}) } as DOMRect;
  };
  const frame = () => act(() => new Promise((r) => setTimeout(r, 30)));
  try {
    renderStrip();
    await frame();
    const link = (name: RegExp) => screen.getByRole("link", { name });
    expect(link(/Diligence/)).toHaveAttribute("aria-current", "location");
    await userEvent.click(link(/Stop chance/));
    // Mid-scroll: f is still above the view.
    tops.pf = -400;
    fireEvent.scroll(window);
    await frame();
    expect(link(/Stop chance/)).toHaveAttribute("aria-current", "location");
    // Settled: f has reached the top of the view (the foot keeps g in view too).
    tops.pf = 57;
    tops.pg = 420;
    fireEvent.scroll(window);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(link(/Stop chance/)).toHaveAttribute("aria-current", "location");
    expect(link(/Diligence/)).not.toHaveAttribute("aria-current");
  } finally {
    Element.prototype.getBoundingClientRect = realRect;
  }
});
