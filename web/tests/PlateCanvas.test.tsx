import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type React from "react";
import { dotRadius, dotScale, fitAnchors, fitToUnit, PlateCanvas, restBox, restFit, type PlateCanvasHandle } from "../src/components/explore/PlateCanvas";
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
  // jsdom lays nothing out: give the canvas a real size, so labels have room to be placed.
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, toJSON: () => ({}) }) as DOMRect,
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => vi.restoreAllMocks());

const isStopped = (t: ExplorerTrial) => t.outcome === "stopped";
const isUnknown = (t: ExplorerTrial) => t.outcome === "unknown";

const renderCanvas = (
  labels?: string[],
  data: ExplorerTrial[] = trials,
  anchors?: { label: string; x: number; y: number; z: number }[],
) => {
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
      anchors={anchors}
      selected={null}
      onSelect={onSelect}
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
  // Turning the map by a drag redraws it every frame without any filter or colour change.
  const canvas = screen.getByRole("img");
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1, button: 0, pointerType: "mouse" });
  for (let i = 1; i <= 5; i++) {
    fireEvent.pointerMove(canvas, { clientX: 100 + i * 12, clientY: 100, pointerId: 1, pointerType: "mouse" });
    step();
  }
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

test("restBox measures the still view's projected box between the 1st and 99th percentiles", () => {
  // 100 points on a flat line along x from 0 to 9.9 (y = z = 0): at rest (no turn, no tilt) u = x * f, f = 1.
  const pts = Array.from({ length: 100 }, (_, i) => ({ x: i / 10, y: 0, z: 0 }));
  const box = restBox(pts, 0);
  expect(box.x0).toBeCloseTo(0, 1);
  expect(box.x1).toBeCloseTo(9.8, 1);
  expect(box.y0).toBeCloseTo(0);
  expect(box.y1).toBeCloseTo(0);
});

test("restFit fills the panel with the trimmed box at one isotropic scale, centred on the box", () => {
  // A box twice as wide as tall, off centre: x 1..3, y -0.5..0.5.
  const box = { x0: 1, x1: 3, y0: -0.5, y1: 0.5 };
  // Wide panel 880 x 560: width-limited (880 / 2 = 440 px per unit) beats height (560 / 1); then x 0.94.
  const f = restFit(box, 880, 560, 0.94);
  expect(f.scale).toBeCloseTo(440 * 0.94);
  // The box centre (2, 0) lands on the panel centre: dx = -scale * 2.
  expect(f.dx).toBeCloseTo(-440 * 0.94 * 2);
  expect(f.dy).toBeCloseTo(0);
  // Tall panel: height no longer binds less than width; still the tighter of the two.
  expect(restFit(box, 200, 600, 0.94).scale).toBeCloseTo(100 * 0.94);
});

const renderStill = () =>
  render(
    <PlateCanvas
      trials={trials}
      visible={() => true}
      color={() => "#111"}
      selected={null}
      onSelect={() => undefined}
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

test("hovering a dot with a mouse reports the trial, the dot's centre and its hover ring's radius", () => {
  const { onHover, dot, first, canvas } = renderHoverable();
  fireEvent.pointerMove(canvas, { clientX: dot.x + 2, clientY: dot.y - 1, pointerType: "mouse" });
  expect(onHover).toHaveBeenCalledTimes(1);
  // The card's leader ends on the ring drawn 4px outside the dot (1.5px stroke), not at the pointer.
  expect(onHover).toHaveBeenLastCalledWith({ nct: first, x: dot.x, y: dot.y, r: dot.r + 4.75 });
  // Still on the same dot: nothing new to report.
  fireEvent.pointerMove(canvas, { clientX: dot.x + 1, clientY: dot.y + 1, pointerType: "mouse" });
  expect(onHover).toHaveBeenCalledTimes(1);
  fireEvent.pointerLeave(canvas, { pointerType: "mouse" });
  expect(onHover).toHaveBeenLastCalledWith(null);
});

test("touch never opens the hover card", () => {
  const { onHover, dot, canvas } = renderHoverable();
  fireEvent.pointerMove(canvas, { clientX: dot.x, clientY: dot.y, pointerType: "touch" });
  expect(onHover).not.toHaveBeenCalled();
});

test("a hovered trial that the filters hide is no longer hovered", () => {
  const { onHover, dot, first, canvas } = renderHoverable();
  fireEvent.pointerMove(canvas, { clientX: dot.x, clientY: dot.y, pointerType: "mouse" });
  expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ nct: first }));
  rerenderHoverable((t) => t.nct_id !== first);
  step();
  expect(onHover).toHaveBeenLastCalledWith(null);
});

/** A 400 x 400 still canvas that reports zoom changes; the first trial drawn in a colour of its own. */
const renderZoomable = (extra: Partial<React.ComponentProps<typeof PlateCanvas>> = {}) => {
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  const onZoomChange = vi.fn();
  const onHover = vi.fn();
  const first = trials[0].nct_id;
  const ref = { current: null as PlateCanvasHandle | null };
  render(
    <PlateCanvas
      ref={ref}
      trials={trials}
      visible={() => true}
      color={(t) => (t.nct_id === first ? "#0f0" : "#111")}
      selected={null}
      onSelect={() => undefined}
      onHover={onHover}
      onZoomChange={onZoomChange}
      {...extra}
    />,
  );
  step();
  const canvas = screen.getByRole("img");
  return { canvas, onZoomChange, onHover, ref, first };
};
/** Where the first trial's dot was last drawn. */
const firstDot = () => {
  const m = marks.filter((x) => x.fill === "#0f0");
  return m[m.length - 1];
};

test("the wheel over the canvas zooms about the pointer, scaling positions but not dot size", () => {
  const { canvas, onZoomChange } = renderZoomable();
  const before = firstDot();
  const wheel = new WheelEvent("wheel", { deltaY: -500, clientX: 200, clientY: 200, bubbles: true, cancelable: true });
  act(() => void canvas.dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(true); // the page does not scroll under the map
  expect(onZoomChange).toHaveBeenCalledTimes(1);
  const k = onZoomChange.mock.calls[0][0] as number;
  expect(k).toBeGreaterThan(1);
  step();
  const after = firstDot();
  expect(after.x).toBeCloseTo(200 + k * (before.x - 200));
  expect(after.y).toBeCloseTo(200 + k * (before.y - 200));
  expect(after.r).toBeCloseTo(before.r);
  // Further zooming in does not report again: only crossing 1x is reported.
  act(() => void canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 200, clientY: 200, cancelable: true })));
  expect(onZoomChange).toHaveBeenCalledTimes(1);
});

test("the canvas is focusable, names its zoom keys, and + / - / 0 zoom and reset", () => {
  const { canvas, onZoomChange } = renderZoomable();
  expect(canvas).toHaveAttribute("tabindex", "0");
  expect(canvas).toHaveAccessibleName(/zoom/i);
  expect(canvas.getAttribute("aria-label")).toMatch(/\+/);
  fireEvent.keyDown(canvas, { key: "+" });
  expect(onZoomChange).toHaveBeenLastCalledWith(expect.any(Number));
  expect(onZoomChange.mock.calls[0][0]).toBeGreaterThan(1);
  fireEvent.keyDown(canvas, { key: "0" });
  expect(onZoomChange).toHaveBeenLastCalledWith(1);
  fireEvent.keyDown(canvas, { key: "=" });
  fireEvent.keyDown(canvas, { key: "-" });
  fireEvent.keyDown(canvas, { key: "-" });
  fireEvent.keyDown(canvas, { key: "-" });
  expect(onZoomChange).toHaveBeenLastCalledWith(1);
});

test("resetView returns to 1x and redraws", () => {
  const { canvas, onZoomChange, ref } = renderZoomable();
  const before = firstDot();
  fireEvent.keyDown(canvas, { key: "+" });
  step();
  expect(firstDot().x).not.toBeCloseTo(before.x);
  act(() => ref.current?.resetView());
  expect(onZoomChange).toHaveBeenLastCalledWith(1);
  step();
  expect(firstDot().x).toBeCloseTo(before.x);
});

test("zoomed in, a plain drag pans and Shift-drag turns; at 1x a drag turns", () => {
  const { canvas } = renderZoomable();
  const drag = (dx: number, shiftKey = false) => {
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 200, pointerId: 1, shiftKey });
    fireEvent.pointerMove(canvas, { clientX: 200 + dx, clientY: 210, pointerId: 1, shiftKey });
    fireEvent.pointerUp(canvas, { clientX: 200 + dx, clientY: 210, pointerId: 1, shiftKey });
    step();
  };
  fireEvent.keyDown(canvas, { key: "+" });
  fireEvent.keyDown(canvas, { key: "+" });
  step();
  const zoomed = firstDot();
  drag(-30);
  const panned = firstDot();
  expect(panned.x).toBeCloseTo(zoomed.x - 30);
  expect(panned.y).toBeCloseTo(zoomed.y + 10);
  drag(-30, true);
  const turned = firstDot();
  // A turn moves the dot by something other than a plain shift of the drag.
  expect(Math.abs(turned.y - panned.y) + Math.abs(turned.x - (panned.x - 30))).toBeGreaterThan(0.5);
});

test("hovering at 2x reports the dot where it is drawn", () => {
  const { canvas, onHover, first } = renderZoomable();
  fireEvent.keyDown(canvas, { key: "+" });
  step();
  const dot = firstDot();
  fireEvent.pointerMove(canvas, { clientX: dot.x + 1, clientY: dot.y, pointerType: "mouse" });
  expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ nct: first, x: dot.x, y: dot.y }));
});

test("a wheel right after a mouse drag finds the dot under the pointer again", () => {
  const { canvas, onHover, first } = renderZoomable();
  fireEvent.keyDown(canvas, { key: "+" });
  step();
  const dot = firstDot();
  // Pan the first dot 20px right, ending the drag exactly on it, with no plain move afterwards.
  const at = { clientX: dot.x + 20, clientY: dot.y, pointerId: 1, pointerType: "mouse" };
  fireEvent.pointerDown(canvas, { clientX: dot.x, clientY: dot.y, pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerMove(canvas, at);
  fireEvent.pointerUp(canvas, at);
  step();
  onHover.mockClear();
  act(() => void canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: at.clientX, clientY: at.clientY, cancelable: true })));
  step();
  expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ nct: first }));
});

test("named anchors (clusters) are labelled where given, in the file's coordinates, instead of condition labels", () => {
  const t = trials[6];
  renderCanvas([trials[0].condition_labels[0]], trials, [{ label: "Anti-CD20 antibodies", x: t.x, y: t.y, z: t.z }]);
  step();
  expect(texts).toEqual(["Anti-CD20 antibodies"]);
});

test("a cluster's disease prefix is set apart from its mechanism or type part", () => {
  const t = trials[6];
  renderCanvas([], trials, [{ label: "D1 · anti-CD20 (ocrelizumab)", x: t.x, y: t.y, z: t.z }]);
  step();
  expect(texts).toEqual(["D1 · ", "anti-CD20 (ocrelizumab)"]);
});

test("numbered (phone): each anchor carries its numeral, not its name", () => {
  const [a, b] = [trials[2], trials[6]];
  render(
    <PlateCanvas
      trials={trials}
      visible={() => true}
      color={() => "#111"}
      anchors={[
        { label: "D1 · anti-CD20 (ocrelizumab)", x: a.x, y: a.y, z: a.z },
        { label: "D1 · devices", x: b.x, y: b.y, z: b.z },
      ]}
      numbered
      selected={null}
      onSelect={() => undefined}
    />,
  );
  step();
  expect([...texts].sort()).toEqual(["1", "2"]);
});

test("an empty anchor list draws no labels, even with condition labels given", () => {
  const planted = trials.map((t, i) => (i < 6 ? { ...t, condition_labels: ["Planted"], x: 0.5, y: 0.5, z: 0 } : t));
  renderCanvas(["Planted"], planted, []);
  step();
  expect(texts).toEqual([]);
});

test("fitAnchors puts an anchor on the fitted position of the trial it sits on", () => {
  const fitted = fitToUnit(trials);
  const t = trials[3];
  expect(fitAnchors(trials, [{ label: "c", x: t.x, y: t.y, z: t.z }])).toEqual([{ label: "c", ...fitted[3] }]);
});
