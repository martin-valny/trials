import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { RiskScale } from "../src/components/risk/RiskScale";

const scale = (p: number, lo: number, hi: number) => render(<RiskScale p={p} lo={lo} hi={hi} typical={0.2} />).container;

test("a range running past the axis end gets an open end; one inside does not", () => {
  const past = scale(0.4, 0.3, 0.75);
  expect(past.querySelector(".rk-range-end")).not.toBeNull();
  expect(past.querySelector(".rk-range")).toHaveStyle({ width: "50.00%" });
  expect(past.querySelector('[role="img"]')).toHaveAttribute("aria-label", "Estimated 40% (30–75); typical 20%");
  expect(scale(0.4, 0.3, 0.55).querySelector(".rk-range-end")).toBeNull();
});

test("an estimate past the axis end keeps its arrowhead, and the band its open end", () => {
  const c = scale(0.7, 0.62, 0.8);
  expect(c.querySelector(".rk-est.over")).not.toBeNull();
  expect(c.querySelector(".rk-range-end")).not.toBeNull();
});
