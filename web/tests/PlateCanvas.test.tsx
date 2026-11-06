import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { dotRadius, dotScale, fitToUnit, fitZoom, plateExtents, PlateCanvas } from "../src/components/explore/PlateCanvas";
import { nearestIndex, type Projected } from "../src/lib/explorer";
import type { ExplorerFile, ExplorerTrial } from "../src/types";
import { readFixture } from "./helpers";

const trials = readFixture<ExplorerFile>("explorer.json").trials;

let frames: FrameRequestCallback[] = [];
let arcs = 0;
/** Every arc drawn, with the context state at that moment and whether it was then filled or stroked. */
let marks: { x: number; r: number; alpha: number; fill: string; stroke: string; op?: "fill" | "stroke" }[] = [];
let texts: string[] = [];

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
  marks = [];
  texts = [];
  const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: "", strokeStyle: "" };
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => {
      if (key === "arc")
        return (x: number, _y: number, r: number) => {
          arcs++;
          marks.push({ x, r, alpha: state.globalAlpha as number, fill: String(state.fillStyle), stroke: String(state.strokeStyle) });
        };
      if (key === "fill" || key === "stroke")
        return () => {
          const m = marks[marks.length - 1];
          if (m && m.op === undefined) m.op = key;
        };
      if (key === "fillText") return (t: string) => void texts.push(t);
      if (key === "measureText") return (t: string) => ({ width: t.length * 6 });
      return () => undefined;
    },
    set: (_t, key, v) => {
      state[key as string] = v;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement["getContext"],
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => vi.restoreAllMocks());

const isStopped = (t: ExplorerTrial) => t.outcome === "stopped";
const isUnknown = (t: ExplorerTrial) => t.outcome === "unknown";

const renderCanvas = (labels?: string[]) => {
  const visible = vi.fn(() => true);
  const color = vi.fn((t: ExplorerTrial) => (isStopped(t) ? "#e00" : "#111"));
  const emphasis = vi.fn(isStopped);
  const hollow = vi.fn(isUnknown);
  const onSelect = vi.fn();
  render(
    <PlateCanvas
      trials={trials}
      visible={visible}
      color={color}
      emphasis={emphasis}
      hollow={hollow}
      labels={labels}
      selected={null}
      onSelect={onSelect}
      reducedMotion={false}
    />,
  );
  return { visible, color, emphasis, hollow, onSelect };
};

/** The marks of the most recent frame (each frame draws one arc per trial plus one per emphasised trial). */
const lastFrame = () => {
  const n = trials.length + trials.filter(isStopped).length;
  return marks.slice(-n);
};

test("visibility, colour, emphasis and ring shape are computed once per change, not per frame", () => {
  const { visible, color, emphasis, hollow } = renderCanvas();
  step();
  const calls = [visible, color, emphasis, hollow].map((f) => f.mock.calls.length);
  expect(calls.every((c) => c > 0)).toBe(true);
  const drawn = arcs;
  for (let i = 0; i < 5; i++) step();
  expect(arcs).toBeGreaterThan(drawn); // frames really drew
  expect([visible, color, emphasis, hollow].map((f) => f.mock.calls.length)).toEqual(calls);
});

test("emphasised dots are drawn last, opaque, at least 3px, with a knockout ring", () => {
  renderCanvas();
  step();
  const k = trials.filter(isStopped).length;
  expect(k).toBeGreaterThan(0);
  const frame = lastFrame();
  // The emphasis pass: for each emphasised dot, a fill then a 1px knockout stroke.
  const tail = frame.slice(-2 * k);
  for (let i = 0; i < k; i++) {
    const dot = tail[2 * i];
    const ring = tail[2 * i + 1];
    expect(dot).toMatchObject({ fill: "#e00", alpha: 1, op: "fill" });
    expect(dot.r).toBeGreaterThanOrEqual(3);
    expect(ring.op).toBe("stroke");
    expect(ring.x).toBe(dot.x);
  }
  // Every other visible dot is at least 0.8 opaque.
  for (const m of frame.slice(0, -2 * k)) expect(m.alpha).toBeGreaterThanOrEqual(0.8);
});

test("hollow trials are stroked rings, not filled dots", () => {
  renderCanvas();
  step();
  const unknownN = trials.filter(isUnknown).length;
  expect(unknownN).toBeGreaterThan(0);
  const k = trials.filter(isStopped).length;
  const base = lastFrame().slice(0, -2 * k);
  expect(base.filter((m) => m.op === "stroke")).toHaveLength(unknownN);
  expect(base.filter((m) => m.op === "fill")).toHaveLength(trials.length - k - unknownN);
});

test("cluster labels are drawn with the canvas, computed from the given condition order", () => {
  const first = trials[0].condition_labels[0];
  renderCanvas([first, "No such condition"]);
  step();
  expect(texts).toContain(first);
  expect(texts).not.toContain("No such condition");
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

test("dot scale shrinks with crowding, clamped to 0.75..1", () => {
  const base = { ...trials[0] };
  const many = (n: number) => Array.from({ length: n }, () => ({ ...base }));
  expect(dotScale(many(100)).k).toBe(1);
  expect(dotScale(many(900)).k).toBeCloseTo(Math.sqrt(600 / 900));
  expect(dotScale(many(1200)).k).toBe(0.75);
  expect(dotScale(many(5000)).k).toBe(0.75);
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
