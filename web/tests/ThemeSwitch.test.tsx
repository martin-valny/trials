import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ThemeSwitch } from "../src/components/ThemeSwitch";

test("cycles system -> light -> dark and paints the page", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitch />);
  const button = screen.getByRole("button", { name: /theme: system/i });
  expect(document.documentElement.dataset.theme).toBe("light");

  await user.click(button);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(button).toHaveAccessibleName(/theme: light/i);
  expect(localStorage.getItem("trialradar.theme")).toBe("light");

  await user.click(button);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(button).toHaveAccessibleName(/theme: dark/i);

  await user.click(button);
  expect(button).toHaveAccessibleName(/theme: system/i);
  expect(document.documentElement.dataset.theme).toBe("light");
});
