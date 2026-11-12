import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DotCanvas, fit, nextFrom } from "../src/components/intro/DotCanvas";
import type { IntroFile } from "../src/types";

const file = JSON.parse(readFileSync("tests/fixtures/data/intro.json", "utf8")) as IntroFile;

let frames: FrameRequestCallback[] = [];
let fills: string[] = [];
let arcs: { x: number; y: number }[] = [];
let strokes: string[] = [];
let sizeCb: ResizeObserverCallback | null = null;
const step = (at: number = performance.now()) =>
  act(() => {
    const run = frames;
    frames = [];
    run.forEach((cb) => cb(at));
  });
const resize = (w: number, h: number) =>
  act(() => sizeCb?.([{ contentRect: { width: w, height: h } } as ResizeObserverEntry], {} as ResizeObserver));

beforeEach(() => {
  frames = [];
  fills = [];
  arcs = [];
  strokes = [];
  sizeCb = null;
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => {
      if (key === "arc") return (x: number, y: number) => arcs.push({ x, y });
      if (key === "measureText") return (t: string) => ({ width: t.length * 6 });
      return () => undefined;
    },
    set: (_t, key, v) => {
      if (key === "fillStyle") fills.push(String(v));
      if (key === "strokeStyle") strokes.push(String(v));
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as unknown as HTMLCanvasElement["getContext"]);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("ResizeObserver", class { constructor(cb: ResizeObserverCallback) { sizeCb = cb; } observe() {} disconnect() {} unobserve() {} });
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.cssText = "--red: #c8102e; --ink: #111; --muted: #5b6268; --run: #3c5488; --stop: #222; --fin: #c9d1d8; --unk: #aab3bb;";
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
});

const props = { file, pairs: [], active: "all" as const, reduced: false, label: "Every trial as a dot" };

test("renders an img canvas with the label", () => {
  render(<DotCanvas {...props} />);
  expect(screen.getByRole("img", { name: "Every trial as a dot" }).tagName).toBe("CANVAS");
});

test("a theme change repaints idle dots in the new colours", async () => {
  render(<DotCanvas {...props} />);
  resize(600, 400);
  step();
  step();
  expect(fills).toContain("#222");
  fills = [];
  await act(async () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.setProperty("--stop", "#eceae4");
  });
  expect(frames.length).toBe(1);
  step();
  expect(frames.length).toBe(0);
  expect(fills).toContain("#eceae4");
  expect(fills).not.toContain("#222");
});

test("nextFrom keeps current positions when the count matches, else starts at the target", () => {
  const cur = [{ x: 5, y: 6, a: 1, r: 2 }];
  const from = nextFrom(cur, [{ x: 9, y: 9, a: 1, r: 2, paint: "adv" }]);
  expect(from).toEqual(cur);
  expect(from[0]).not.toBe(cur[0]);
  expect(nextFrom(null, [{ x: 9, y: 8, a: 0.5, r: 3, paint: "adv" }])).toEqual([{ x: 9, y: 8, a: 0.5, r: 3 }]);
});

test("a resize mid-transition re-targets from the current positions, not from (0,0)", () => {
  const { rerender } = render(<DotCanvas {...props} />);
  resize(600, 400);
  step();
  rerender(<DotCanvas {...props} active="pipeline" />);
  step();
  const mid = arcs.slice(-file.trials.id.length).map((a) => ({ ...a }));
  arcs = [];
  resize(500, 380);
  step();
  const first = arcs.slice(0, file.trials.id.length);
  expect(first.some((p) => p.x === 0 && p.y === 0)).toBe(false);
  expect(Math.max(...first.map((p, i) => Math.hypot(p.x - mid[i].x, p.y - mid[i].y)))).toBeLessThan(60);
});

test("the loop stops scheduling frames once the transition and label fade are done", () => {
  const { rerender } = render(<DotCanvas {...props} />);
  resize(600, 400);
  step();
  expect(frames.length).toBe(0);
  rerender(<DotCanvas {...props} active="pipeline" />);
  expect(frames.length).toBe(1);
  step(performance.now() + 100);
  expect(frames.length).toBe(1);
  step(performance.now() + 5000);
  expect(frames.length).toBe(0);
});

test("token lookups per frame are per distinct paint, not per dot", () => {
  const spy = vi.spyOn(Object.getPrototypeOf(getComputedStyle(document.documentElement)), "getPropertyValue");
  render(<DotCanvas {...props} />);
  resize(600, 400);
  spy.mockClear();
  frames.length = 0;
  document.documentElement.dataset.theme = "dark";
  act(() => { resize(601, 400); });
  spy.mockClear();
  step();
  expect(spy.mock.calls.length).toBeGreaterThan(0);
  expect(spy.mock.calls.length).toBeLessThan(file.trials.id.length);
  expect(spy.mock.calls.length).toBeLessThanOrEqual(20);
});

test("fit keeps the label size at 12px or more and the result inside the room", () => {
  const ctx = { font: "", measureText: (t: string) => ({ width: t.length * 7 }) } as unknown as CanvasRenderingContext2D;
  const r = fit(ctx, { text: "Trials in several approaches are under More than one", x: 20, y: 0, size: 12 }, 343);
  expect(r.size).toBeGreaterThanOrEqual(12);
  expect(r.text.endsWith("…")).toBe(true);
  expect(r.text.length * 7).toBeLessThanOrEqual(343 - 20);
  expect(fit(ctx, { text: "short", x: 0, y: 0 }, 343)).toEqual({ text: "short", size: 12 });
});

test("labels that would run past the edge are shrunk or truncated", () => {
  const texts: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => {
      if (key === "fillText") return (t: string) => texts.push(t);
      if (key === "measureText") return (t: string) => ({ width: t.length * 7 });
      return () => undefined;
    },
    set: () => true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as unknown as HTMLCanvasElement["getContext"]);
  render(<DotCanvas {...props} active="approaches" />);
  resize(343, 600);
  step();
  step();
  const note = texts.find((t) => t.startsWith("Trials in several"));
  expect(note).toBeDefined();
  expect(note!.length * 7).toBeLessThanOrEqual(343);
  expect(note!.endsWith("…")).toBe(true);
});
