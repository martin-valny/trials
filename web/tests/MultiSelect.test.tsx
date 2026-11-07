import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { MultiSelect } from "../src/components/explore/MultiSelect";

const OPTIONS = [
  { value: "lung", label: "Lung cancer", n: 12 },
  { value: "breast", label: "Breast cancer", n: 7 },
  { value: "melanoma", label: "Melanoma", n: 3 },
];
const ALL = OPTIONS.map((o) => o.value);

function setup(props: { selected?: string[]; searchable?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <div>
      <p>outside</p>
      <MultiSelect
        label="Disease"
        options={OPTIONS}
        selected={new Set(props.selected ?? ALL)}
        onChange={onChange}
        searchable={props.searchable}
      />
    </div>,
  );
  return { onChange, user: userEvent.setup() };
}

const lastSet = (fn: ReturnType<typeof vi.fn>) => [...(fn.mock.lastCall?.[0] as Set<string>)].sort();

test("button reads the summary and opens a labelled group of checkboxes with counts", async () => {
  const { user } = setup();
  const button = screen.getByRole("button", { name: "Disease: all" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  await user.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  const group = screen.getByRole("group", { name: "Disease" });
  expect(button).toHaveAttribute("aria-controls", group.closest("[id]")?.id);
  for (const o of OPTIONS) {
    const box = within(group).getByRole("checkbox", { name: `${o.label} ${o.n}` });
    expect(box).toBeChecked();
    expect(box.closest("label")).toHaveTextContent(String(o.n));
  }
});

test("button summary counts a partial selection", () => {
  setup({ selected: ["lung", "melanoma"] });
  expect(screen.getByRole("button", { name: "Disease: 2 of 3" })).toBeInTheDocument();
});

test("Select none empties the set and Select all selects every value", async () => {
  const { user, onChange } = setup({ selected: ["lung"] });
  await user.click(screen.getByRole("button", { name: "Disease: 1 of 3" }));
  await user.click(screen.getByRole("button", { name: "Select none" }));
  expect(lastSet(onChange)).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect(lastSet(onChange)).toEqual([...ALL].sort());
});

test("unchecking one option removes only that value", async () => {
  const { user, onChange } = setup();
  await user.click(screen.getByRole("button", { name: "Disease: all" }));
  await user.click(screen.getByRole("checkbox", { name: /Breast cancer/ }));
  expect(lastSet(onChange)).toEqual(["lung", "melanoma"]);
});

test("Escape closes and returns focus to the button", async () => {
  const { user } = setup();
  const button = screen.getByRole("button", { name: "Disease: all" });
  await user.click(button);
  await user.click(screen.getByRole("checkbox", { name: /Melanoma/ }));
  await user.keyboard("{Escape}");
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("group", { name: "Disease" })).not.toBeInTheDocument();
  expect(button).toHaveFocus();
});

test("clicking outside closes", async () => {
  const { user } = setup();
  const button = screen.getByRole("button", { name: "Disease: all" });
  await user.click(button);
  await user.click(screen.getByText("outside"));
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("group", { name: "Disease" })).not.toBeInTheDocument();
});

test("searchable: typing filters the visible checkboxes, and Select all then applies to the visible ones only", async () => {
  const { user, onChange } = setup({ selected: [], searchable: true });
  await user.click(screen.getByRole("button", { name: "Disease: none" }));
  await user.type(screen.getByRole("searchbox", { name: "Filter Disease" }), "cancer");
  const group = screen.getByRole("group", { name: "Disease" });
  expect(within(group).getAllByRole("checkbox").map((b) => b.closest("label")?.textContent)).toEqual([
    expect.stringContaining("Lung cancer"),
    expect.stringContaining("Breast cancer"),
  ]);
  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect(lastSet(onChange)).toEqual(["breast", "lung"]);
});

test("searchable: Select none clears only the visible ones", async () => {
  function Host() {
    const [sel, setSel] = useState<ReadonlySet<string>>(new Set(ALL));
    return <MultiSelect label="Disease" options={OPTIONS} selected={sel} onChange={setSel} searchable />;
  }
  render(<Host />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Disease: all" }));
  await user.type(screen.getByRole("searchbox", { name: "Filter Disease" }), "mel");
  await user.click(screen.getByRole("button", { name: "Select none" }));
  expect(screen.getByRole("button", { name: "Disease: 2 of 3" })).toBeInTheDocument();
});

test("Tab moving focus out of the popover closes it", async () => {
  render(
    <div>
      <MultiSelect label="Disease" options={OPTIONS} selected={new Set(ALL)} onChange={() => undefined} />
      <button type="button">after</button>
    </div>,
  );
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: "Disease: all" });
  await user.click(button);
  // Done (the phone sheet's header; CSS hides it on wide screens, jsdom has no CSS), Select all, Select none,
  // then the three checkboxes; one more Tab leaves the wrapper.
  for (let i = 0; i < 6; i++) await user.tab();
  expect(screen.getByRole("checkbox", { name: /Melanoma/ })).toHaveFocus();
  expect(button).toHaveAttribute("aria-expanded", "true");
  await user.tab();
  expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  expect(button).toHaveAttribute("aria-expanded", "false");
});

test("the sheet's Done button closes it and returns focus to the dropdown button", async () => {
  const { user } = setup();
  const button = screen.getByRole("button", { name: "Disease: all" });
  await user.click(button);
  const pop = document.getElementById(button.getAttribute("aria-controls")!)!;
  expect(within(pop).getByText("Disease", { selector: ".sheet-title" })).toBeInTheDocument();
  await user.click(within(pop).getByRole("button", { name: "Done" }));
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(button).toHaveFocus();
});

test("opened as a phone sheet, it scrolls the page so the map sits in view above the sheet", async () => {
  const realStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const s = realStyle(el, pseudo);
    return (el as Element).classList?.contains("popover") ? ({ ...s, position: "fixed" } as CSSStyleDeclaration) : s;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = (top: number, height: number) =>
      ({ top, bottom: top + height, height, left: 0, right: 375, width: 375, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    if (this.classList.contains("popover")) return box(455, 357);
    if (this.dataset.sheetReveal !== undefined) return box(600, 343);
    return box(0, 0);
  });
  const scrollBy = vi.fn();
  vi.stubGlobal("scrollBy", scrollBy);
  const user = userEvent.setup();
  render(
    <div>
      <MultiSelect label="Disease" options={OPTIONS} selected={new Set(ALL)} onChange={() => undefined} />
      <div data-sheet-reveal="" />
    </div>,
  );
  await user.click(screen.getByRole("button", { name: /Disease/ }));
  // The map's bottom (943) moves up to 8px above the sheet's top edge (455).
  expect(scrollBy).toHaveBeenCalledWith({ top: 943 - 447, behavior: "instant" });
  vi.restoreAllMocks();
});

test("at rest the button shows only its name; narrowed, it adds ': value'", () => {
  setup();
  const button = screen.getByRole("button", { name: "Disease: all" });
  // The value stays in the accessible name but is not shown at rest.
  expect(button.querySelector(".dropdown-summary")).toHaveClass("visually-hidden");
});

test("a narrowed dropdown shows ': value' with the value in 700", () => {
  setup({ selected: ["lung"] });
  const button = screen.getByRole("button", { name: "Disease: 1 of 3" });
  expect(button.querySelector(".dropdown-summary")).not.toHaveClass("visually-hidden");
  expect(button).toHaveAttribute("data-narrowed", "true");
});
