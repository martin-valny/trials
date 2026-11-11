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
  expect(button).toHaveAccessibleName("Years: all");
  expect(button).toHaveTextContent(/^Years$/); // at rest only the name shows
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

test("a partial From entry is held as a draft until blur or Enter, then clamped", async () => {
  render(<Host initial={[2012, 2018]} />);
  const { user, button } = await open();
  const from = screen.getByRole("spinbutton", { name: "From" });
  await user.clear(from);
  await user.type(from, "20");
  expect(from).toHaveValue(20);
  expect(button).toHaveTextContent("Years: 2012–2018");
  await user.keyboard("{Enter}");
  expect(from).toHaveValue(2010);
  expect(button).toHaveTextContent("Years: 2010–2018");
});

test("a To value below From pulls From down", async () => {
  render(<Host initial={[2014, 2018]} />);
  const { user, button } = await open();
  const to = screen.getByRole("spinbutton", { name: "To" });
  await user.clear(to);
  await user.type(to, "2011");
  expect(screen.getByRole("spinbutton", { name: "From" })).toHaveValue(2011);
  expect(button).toHaveTextContent("Years: 2011–2011");
});

test("the From thumb is stacked above To when From sits in the upper half, so the range can be widened", async () => {
  render(<Host initial={[2026, 2026]} />);
  await open();
  expect(screen.getByRole("slider", { name: "From year" })).toHaveClass("front");
});

test("the To thumb stays on top while From is in the lower half", async () => {
  render(<Host initial={[2010, 2010]} />);
  await open();
  expect(screen.getByRole("slider", { name: "From year" })).not.toHaveClass("front");
});

test("is not offered when no trial has a start year (bounds [0, 0])", () => {
  render(<YearRange bounds={[0, 0]} value={[0, 0]} onChange={() => undefined} />);
  expect(screen.queryByRole("button", { name: /^Years:/ })).not.toBeInTheDocument();
});
