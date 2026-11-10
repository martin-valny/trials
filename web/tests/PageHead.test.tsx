import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { PageHead } from "../src/components/PageHead";

test("PageHead renders crumb, title, sentence and aside, sentence before aside in reading order", () => {
  const { container } = render(
    <PageHead crumb={<a href="/">Pipeline</a>} title="Changes" sentence="One computed sentence." aside={<span>Aside</span>} />,
  );
  const head = container.querySelector("header")!;
  expect(head).toHaveClass("page-head");
  expect(screen.getByRole("heading", { level: 1, name: "Changes" })).toBeInTheDocument();
  expect([...head.children].map((c) => c.className || c.tagName)).toEqual([
    "page-head-crumb",
    "H1",
    "page-head-sentence",
    "page-head-aside",
  ]);
});

test("PageHead leaves absent parts out and appends a className", () => {
  const { container } = render(<PageHead title="Trials" className="trials-head" />);
  const head = container.querySelector("header")!;
  expect(head.className).toBe("page-head trials-head");
  expect([...head.children].map((c) => c.tagName)).toEqual(["H1"]);
});
