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
    const box = within(group).getByRole("checkbox", { name: new RegExp(o.label) });
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
