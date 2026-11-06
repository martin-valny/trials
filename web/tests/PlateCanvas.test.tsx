import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { dotRadius, dotScale, fitToUnit, fitZoom, plateExtents, PlateCanvas } from "../src/components/explore/PlateCanvas";
import { nearestIndex, type Projected } from "../src/lib/explorer";
import type { ExplorerFile } from "../src/types";
import { readFixture } from "./helpers";

const trials = readFixture<ExplorerFile>("explorer.json").trials;

let frames: FrameRequestCallback[] = [];
let arcs = 0;

/** Run every queued animation frame once. */
const step = () =>
  act(() => {
    const run = frames;
    frames = [];
    run.forEach((cb) => cb(performance.now()));
  });

beforeEach(() => {
  frames = [];
  arcs = 0;
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => (key === "arc" ? () => void arcs++ : () => undefined),
    set: () => true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement["getContext"],
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => vi.restoreAllMocks());

const renderCanvas = () => {
  const visible = vi.fn(() => true);
  const color = vi.fn(() => "#111");
  const onSelect = vi.fn();
  render(
    <PlateCanvas
      trials={trials}
      visible={visible}
      color={color}
      selected={null}
      onSelect={onSelect}
      reducedMotion={false}
    />,
  );
  return { visible, color, onSelect };
};

test("visibility and colour are computed once per change, not per frame", () => {
  const { visible, color } = renderCanvas();
  step();
  const v = visible.mock.calls.length;
  const c = color.mock.calls.length;
  const drawn = arcs;
  for (let i = 0; i < 5; i++) step();
  expect(arcs).toBeGreaterThan(drawn); // frames really drew
  expect(visible.mock.calls.length).toBe(v);
  expect(color.mock.calls.length).toBe(c);
});

test("pointercancel ends a drag without selecting", () => {
  const { onSelect } = renderCanvas();
  step();
  const canvas = screen.getByRole("img");
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerCancel(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
  expect(onSelect).not.toHaveBeenCalled();
});

test("nearestIndex skips points hidden by the mask", () => {
  const pts: Projected[] = [
    { sx: 0, sy: 0, depth: 0, f: 1 },
    { sx: 5, sy: 0, depth: 0, f: 1 },
  ];
  expect(nearestIndex(pts, 0, 0)).toBe(0);
  expect(nearestIndex(pts, 0, 0, 12, Uint8Array.from([0, 1]))).toBe(1);
  expect(nearestIndex(pts, 0, 0, 12, Uint8Array.from([0, 0]))).toBe(-1);
});

test("fitToUnit scales by the 98th-percentile radius of the full set", () => {
  const base = { ...trials[0] };
  const ring = Array.from({ length: 999 }, (_, i) => ({
    ...base,
    x: Math.cos(i),
    y: Math.sin(i),
    z: 0,
  }));
  const outlier = { ...base, x: 50, y: 0, z: 0 };
  const fitted = fitToUnit([...ring, outlier]);
  const r = fitted.map((p) => Math.hypot(p.x, p.y, p.z)).sort((a, b) => a - b);
  // The outlier no longer shrinks the cloud: the bulk sits near the unit sphere.
  expect(r[499]).toBeGreaterThan(0.9);
  expect(r[999]).toBeGreaterThan(1.5);
});

test("dot size is capped at the 98th-percentile enrollment", () => {
  const base = { ...trials[0] };
  const normal = Array.from({ length: 999 }, (_, i) => ({ ...base, enrollment: 10 + i }));
  const giant = { ...base, enrollment: 160000 };
  const scale = dotScale([...normal, giant]);
  const e98 = [...normal.map((t) => t.enrollment), 160000].sort((a, b) => a - b)[Math.floor(0.98 * 999)];
  expect(scale.e98).toBe(e98);
  expect(dotRadius(160000, 1, scale)).toBeCloseTo(dotRadius(e98, 1, scale));
  expect(dotRadius(10, 1, scale)).toBeLessThan(dotRadius(e98, 1, scale));
});

test("dot scale shrinks with crowding, clamped to 0.55..1", () => {
  const base = { ...trials[0] };
  const many = (n: number) => Array.from({ length: n }, () => ({ ...base }));
  expect(dotScale(many(100)).k).toBe(1);
  expect(dotScale(many(1200)).k).toBeCloseTo(Math.sqrt(600 / 1200));
  expect(dotScale(many(5000)).k).toBe(0.55);
});

test("fitToUnit uses the in-plane radius and stays isotropic", () => {
  const base = { ...trials[0] };
  // A flat disc of radius 2 in x/y with a deep z spread: in-plane fit puts the disc on the unit circle.
  const pts = Array.from({ length: 500 }, (_, i) => ({ ...base, x: 2 * Math.cos(i), y: 2 * Math.sin(i), z: i % 2 ? 4 : -4 }));
  const fitted = fitToUnit(pts);
  const inPlane = fitted.map((p) => Math.hypot(p.x, p.y));
  expect(Math.max(...inPlane)).toBeCloseTo(1, 1);
  // Isotropic: z is scaled by the same factor (4 / 2).
  expect(Math.abs(fitted[0].z)).toBeCloseTo(2, 1);
});

test("fitZoom fills a wide panel with one isotropic scale", () => {
  // A cloud twice as wide (about the spin axis) as it is tall.
  const ext = { horizontal: 1, vertical: 0.5 };
  // Wide panel: width-limited (440 / 1) beats height-limited (280 / 0.5); scale = 440 * 0.9 px per unit.
  const z = fitZoom(ext, 880, 560, 0.9);
  expect(z * (Math.min(880, 560) / 2)).toBeCloseTo(440 * 0.9);
  // Square panel: still width-limited by the wider horizontal spread.
  expect(fitZoom(ext, 400, 400, 0.9) * 200).toBeCloseTo(200 * 0.9);
});

test("plateExtents measures spin-axis and tilted vertical spread at the 98th percentile", () => {
  const pts = Array.from({ length: 100 }, (_, i) => ({ x: i % 2 ? 1 : -1, y: 0, z: 0 }));
  const e = plateExtents(pts, 0);
  expect(e.horizontal).toBeCloseTo(1);
  expect(e.vertical).toBeCloseTo(0);
});
