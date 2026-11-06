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
let marks: { x: number; y: number; r: number; alpha: number; fill: string; stroke: string; op?: "fill" | "stroke" }[] = [];
let texts: string[] = [];
let clears = 0;

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
  clears = 0;
  const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: "", strokeStyle: "" };
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, key) => {
      if (key === "arc")
        return (x: number, y: number, r: number) => {
          arcs++;
          marks.push({ x, y, r, alpha: state.globalAlpha as number, fill: String(state.fillStyle), stroke: String(state.strokeStyle) });
        };
      if (key === "fill" || key === "stroke")
        return () => {
          const m = marks[marks.length - 1];
          if (m && m.op === undefined) m.op = key;
        };
      if (key === "clearRect") return () => void clears++;
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

const renderCanvas = (labels?: string[], data: ExplorerTrial[] = trials) => {
  const visible = vi.fn(() => true);
  const color = vi.fn((t: ExplorerTrial) => (isStopped(t) ? "#e00" : "#111"));
  const emphasis = vi.fn(isStopped);
  const hollow = vi.fn(isUnknown);
  const onSelect = vi.fn();
  render(
    <PlateCanvas
      trials={data}
      visible={visible}
      color={color}
      emphasis={emphasis}
      hollow={hollow}
      labels={labels}
      selected={null}
      onSelect={onSelect}
      reducedMotion={false}
      spinning={true}
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

test("cluster labels are drawn for planted clusters, not for the background condition", () => {
  const background = trials[0].condition_labels[0];
  // Every fixture trial shares one first label: that is the background, so it gets no label.
  renderCanvas([background, "No such condition"]);
  step();
  expect(texts).toEqual([]);
  // Plant six trials at one point under a new first label: that cluster is labelled.
  const planted = trials.map((t, i) => (i < 6 ? { ...t, condition_labels: ["Planted"], x: 0.5, y: 0.5, z: 0 } : t));
  renderCanvas(["Planted", "No such condition"], planted);
  step();
  expect(texts).toContain("Planted");
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

const renderStill = () =>
  render(
    <PlateCanvas
      trials={trials}
      visible={() => true}
      color={() => "#111"}
      selected={null}
      onSelect={() => undefined}
      reducedMotion={true}
      spinning={true}
    />,
  );

test("redraws once when the web fonts have loaded, so labels use the real face", async () => {
  let loaded: () => void = () => undefined;
  const ready = new Promise<void>((r) => (loaded = r));
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
  try {
    renderStill();
    step();
    const drawn = arcs;
    expect(drawn).toBeGreaterThan(0);
    step();
    expect(arcs).toBe(drawn); // still: nothing changed, nothing drawn
    await act(async () => {
      loaded();
      await ready;
    });
    step();
    expect(arcs).toBeGreaterThan(drawn);
  } finally {
    delete (document as { fonts?: unknown }).fonts;
  }
});

test("the draw loop pauses while the canvas is offscreen and resumes when it returns", () => {
  let report: (entries: { isIntersecting: boolean }[]) => void = () => undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        report = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  try {
    renderCanvas();
    step();
    expect(frames.length).toBe(1);
    act(() => report([{ isIntersecting: false }]));
    const drawn = arcs;
    step();
    expect(arcs).toBe(drawn); // no drawing offscreen
    expect(frames.length).toBe(0); // and no frame scheduled
    act(() => report([{ isIntersecting: true }]));
    expect(frames.length).toBe(1);
    step();
    expect(arcs).toBeGreaterThan(drawn);
  } finally {
    vi.unstubAllGlobals();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  }
});

test("a still map draws once and then stays still", () => {
  render(
    <PlateCanvas
      trials={trials}
      visible={() => true}
      color={() => "#111"}
      selected={null}
      onSelect={() => undefined}
      reducedMotion={false}
      spinning={false}
    />,
  );
  step();
  const drawn = clears;
  expect(drawn).toBeGreaterThan(0);
  step();
  step();
  expect(clears).toBe(drawn);
});

/** A 400 x 400 still canvas with the first trial drawn in a colour of its own, to find it on screen. */
const renderHoverable = () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  const onHover = vi.fn();
  const first = trials[0].nct_id;
  const ui = (visible: (t: ExplorerTrial) => boolean) => (
    <PlateCanvas
      trials={trials}
      visible={visible}
      color={(t) => (t.nct_id === first ? "#0f0" : "#111")}
      selected={null}
      onSelect={() => undefined}
      reducedMotion={false}
      spinning={false}
      onHover={onHover}
    />
  );
  const { rerender } = render(ui(() => true));
  step();
  const dot = marks.find((m) => m.fill === "#0f0");
  if (!dot) throw new Error("first trial not drawn");
  rerenderHoverable = (visible) => rerender(ui(visible));
  return { onHover, dot, first, canvas: screen.getByRole("img") };
};
let rerenderHoverable: (visible: (t: ExplorerTrial) => boolean) => void = () => undefined;

test("hovering a dot with a mouse reports the trial and where the pointer is", () => {
  const { onHover, dot, first, canvas } = renderHoverable();
  fireEvent.pointerMove(canvas, { clientX: dot.x, clientY: dot.y, pointerType: "mouse" });
  expect(onHover).toHaveBeenCalledTimes(1);
  expect(onHover).toHaveBeenLastCalledWith({ nct: first, x: dot.x, y: dot.y });
  // Still on the same dot: nothing new to report.
  fireEvent.pointerMove(canvas, { clientX: dot.x + 1, clientY: dot.y, pointerType: "mouse" });
  expect(onHover).toHaveBeenCalledTimes(1);
  fireEvent.pointerLeave(canvas, { pointerType: "mouse" });
  expect(onHover).toHaveBeenLastCalledWith(null);
});

test("touch never opens the hover card", () => {
  const { onHover, dot, canvas } = renderHoverable();
  fireEvent.pointerMove(canvas, { clientX: dot.x, clientY: dot.y, pointerType: "touch" });
  expect(onHover).not.toHaveBeenCalled();
});

test("the spin pauses while a dot is hovered", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  render(
    <PlateCanvas
      trials={trials}
      visible={() => true}
      color={() => "#111"}
      selected={null}
      onSelect={() => undefined}
      reducedMotion={false}
      spinning={true}
      onHover={() => undefined}
    />,
  );
  step();
  const dot = marks[marks.length - 1];
  fireEvent.pointerMove(screen.getByRole("img"), { clientX: dot.x, clientY: dot.y, pointerType: "mouse" });
  step(); // redraws once for the hover ring
  const drawn = clears;
  step();
  step();
  expect(clears).toBe(drawn);
});

test("a hovered trial that the filters hide is no longer hovered", () => {
  const { onHover, dot, first, canvas } = renderHoverable();
  fireEvent.pointerMove(canvas, { clientX: dot.x, clientY: dot.y, pointerType: "mouse" });
  expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ nct: first }));
  rerenderHoverable((t) => t.nct_id !== first);
  step();
  expect(onHover).toHaveBeenLastCalledWith(null);
});
