import { render, screen, within } from "@testing-library/react";
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

test("?panel=f on load scrolls to #pf once", () => {
  renderStrip("/target/cd20?panel=f");
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.contexts[0]).toBe(document.getElementById("pf"));
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
