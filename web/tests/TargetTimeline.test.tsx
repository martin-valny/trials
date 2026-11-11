import { render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { asOfPlacement, TargetTimeline } from "../src/components/target/TargetTimeline";
import type { PipelineFile } from "../src/types";
import { readFixture } from "./helpers";

const file = readFixture<PipelineFile>("pipeline.json");
const row = file.rows.find((r) => r.id === "cd20")!;

/** The figure at a given container width (ResizeObserver reports it once). */
function draw(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: () => void) {}
      observe() {
        this.cb();
      }
      disconnect() {}
    },
  );
  const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  try {
    return render(<TargetTimeline file={file} label={row.label} marks={row.marks} disease={null} onOpen={() => {}} />);
  } finally {
    if (cw) Object.defineProperty(HTMLElement.prototype, "clientWidth", cw);
  }
}

afterEach(() => vi.unstubAllGlobals());

const SCALE = new Set([12, 13, 14, 15, 19]);

test.each([1200, 343])("every SVG text size is on the type scale at %ipx; 11px only for the year ticks", (width) => {
  const { container } = draw(width);
  expect(container.querySelector("svg[role=img]")).toHaveAttribute("width", String(width));
  const texts = [...container.querySelectorAll("svg[role=img] text")];
  expect(texts.length).toBeGreaterThan(2);
  for (const t of texts) {
    const size = Number(t.getAttribute("font-size"));
    if (size === 11) expect(t.textContent).toMatch(/^\d{4}$/);
    else expect(SCALE.has(size), `${t.textContent}: ${size}px`).toBe(true);
  }
  const asOf = texts.find((t) => t.textContent?.startsWith("Data as of"))!;
  expect(asOf.getAttribute("font-size")).toBe("12");
});

test("the Data as of label is set to the left of the rule when it would overrun the plot's right edge", () => {
  const text = "Data as of 6 Nov 2026";
  expect(asOfPlacement(600, 1200, false, text)).toEqual({ x: 606, anchor: "start" });
  expect(asOfPlacement(1150, 1200, false, text)).toEqual({ x: 1144, anchor: "end" });
  expect(asOfPlacement(300, 343, true, text)).toEqual({ x: 296, anchor: "end" });
});
