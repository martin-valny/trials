import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { YearRange } from "../src/components/explore/YearRange";

function Host({ initial = [2010, 2026] as [number, number] }) {
  const [v, setV] = useState<[number, number]>(initial);
  return <YearRange bounds={[2010, 2026]} value={v} onChange={setV} />;
}

const open = async () => {
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: /^Years:/ });
  await user.click(button);
  return { user, button };
};

test("button reads all for the full range and opens From/To inputs with the bounds", async () => {
  render(<Host />);
  const { button } = await open();
  expect(button).toHaveTextContent("Years: all");
  expect(button).toHaveAttribute("aria-expanded", "true");
  const from = screen.getByRole("spinbutton", { name: "From" });
  const to = screen.getByRole("spinbutton", { name: "To" });
  for (const el of [from, to]) {
    expect(el).toHaveAttribute("min", "2010");
    expect(el).toHaveAttribute("max", "2026");
  }
  expect(screen.getAllByRole("slider")).toHaveLength(2);
});

test("typing From beyond the upper bound clamps to 2026, and To moves up to meet it", async () => {
  render(<Host />);
  const { user, button } = await open();
  const from = screen.getByRole("spinbutton", { name: "From" });
  await user.clear(from);
  await user.type(from, "2030");
  expect(from).toHaveValue(2026);
  expect(screen.getByRole("spinbutton", { name: "To" })).toHaveValue(2026);
  expect(button).toHaveTextContent("Years: 2026–2026");
});

test("From greater than To moves To up to From; button text updates", async () => {
  render(<Host initial={[2012, 2018]} />);
  const { user, button } = await open();
  expect(button).toHaveTextContent("Years: 2012–2018");
  const from = screen.getByRole("spinbutton", { name: "From" });
  await user.clear(from);
  await user.type(from, "2020");
  expect(screen.getByRole("spinbutton", { name: "To" })).toHaveValue(2020);
  expect(button).toHaveTextContent("Years: 2020–2020");
});

test("Escape closes and returns focus to the button", async () => {
  render(<Host />);
  const { user, button } = await open();
  await user.click(screen.getByRole("spinbutton", { name: "From" }));
  await user.keyboard("{Escape}");
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(button).toHaveFocus();
});
