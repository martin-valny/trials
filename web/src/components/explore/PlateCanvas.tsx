import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  clusterAnchors,
  clampView,
  columnLabels,
  columnSide,
  IDENTITY_VIEW,
  nearestIndex,
  panBy,
  placeLabels,
  project,
  viewPoints,
  zoomAt,
  type Projected,
  type View,
} from "../../lib/explorer";
import type { ExplorerTrial } from "../../types";

export interface PlateCanvasProps {
  trials: ExplorerTrial[];
  visible: (t: ExplorerTrial) => boolean;
  color: (t: ExplorerTrial) => string;
  /** Visible trials drawn again on top, opaque and at least 3px, with a knockout ring. */
  emphasis?: (t: ExplorerTrial) => boolean;
  /** Trials drawn as a hollow 1px ring instead of a filled dot. */
  hollow?: (t: ExplorerTrial) => boolean;
  /** Condition labels, in the area's order, to annotate at each condition's densest point (see clusterAnchors). */
  labels?: string[];
  /** Set the cluster labels in a column at the right edge (phone widths), not beside each cluster. */
  labelColumn?: boolean;
  selected: string | null;
  onSelect: (nct: string | null) => void;
  reducedMotion: boolean;
  /** Turn the map slowly; reduced motion overrides it. The spin also pauses while a dot is hovered. */
  spinning: boolean;
  /** The trial under a mouse or pen pointer, at the pointer in canvas CSS px; null when it leaves. Never on touch. */
  onHover?: (h: PlateHover | null) => void;
  /** Ring drawn around the selected and hovered dot; defaults to the canvas's CSS colour. */
  ringColor?: string;
  /** The zoom level, reported only when it crosses 1x (zoomed in, or back to 1x). */
  onZoomChange?: (zoom: number) => void;
  ref?: Ref<PlateCanvasHandle>;
}

export interface PlateCanvasHandle {
  /** Back to 1x with no pan; the turn is kept. */
  resetView(): void;
  /** Move keyboard focus to the map (its zoom keys work while it has focus). */
  focus(): void;
}

/** The hovered trial's dot, in canvas CSS px: its centre and the radius of the ring drawn around it. */
export interface PlateHover {
  nct: string;
  x: number;
  y: number;
  r: number;
}

const SPIN = 0.0022; // radians per frame, as in the approved plate
const TILT = 0.32;
const ZOOM = 0.9; // of the half-size of the panel, after fitting the cloud's in-plane spread to the unit circle
const DRAG = 0.008; // radians per dragged pixel
const CLICK_SLOP = 4; // px of pointer travel still counted as a click
const EMPHASIS_MIN_R = 3; // px
const LABEL_FONT = '600 11.5px "Hanken Grotesk", system-ui, sans-serif';
const LABEL_OFFSET = 8; // px right of and above the anchor dot
const COLUMN_TOP = 40; // px: the phone label column starts below the play control
const RING_GAP = 4; // px between a dot and its selection or hover ring
const RING_WIDTH = 1.5;
const KEY_ZOOM = 1.5; // per press of + or -
const WHEEL_ZOOM = 0.0015; // per wheel pixel; a trackpad pinch (ctrl + wheel) sends small deltas, so 0.01
const PINCH_WHEEL_ZOOM = 0.01;

/** True when this browser gives a 2D canvas context (jsdom and some locked-down browsers do not). */
function canDraw(): boolean {
  try {
    return document.createElement("canvas").getContext("2d") !== null;
  } catch {
    return false;
  }
}

/**
 * Centre the cloud on its centroid and scale it so the 98th-percentile trial sits on the unit circle
 * in the x/y plane (the face the plate shows). One factor for all three axes keeps the shape true.
 * Computed over the full trial set (never per filter) so the cloud does not jump when filtering;
 * the few trials beyond the percentile may clip at the panel edge.
 */
export function fitToUnit(trials: ExplorerTrial[]): { x: number; y: number; z: number }[] {
  const n = trials.length || 1;
  const cx = trials.reduce((a, t) => a + t.x, 0) / n;
  const cy = trials.reduce((a, t) => a + t.y, 0) / n;
  const cz = trials.reduce((a, t) => a + t.z, 0) / n;
  const r = Math.max(1e-9, percentile(trials.map((t) => Math.hypot(t.x - cx, t.y - cy)), 0.98));
  return trials.map((t) => ({ x: (t.x - cx) / r, y: (t.y - cy) / r, z: (t.z - cz) / r }));
}

export interface PlateExtents {
  /** 98th-percentile distance from the spin axis: the widest the cloud gets on screen as it turns. */
  horizontal: number;
  /** 98th-percentile screen height above or below centre once the view is tilted. */
  vertical: number;
}

export function plateExtents(points: { x: number; y: number; z: number }[], tilt: number): PlateExtents {
  const ct = Math.abs(Math.cos(tilt));
  const st = Math.abs(Math.sin(tilt));
  return {
    horizontal: Math.max(1e-6, percentile(points.map((p) => Math.hypot(p.x, p.z)), 0.98)),
    vertical: Math.max(1e-6, percentile(points.map((p) => Math.abs(p.y) * ct + Math.hypot(p.x, p.z) * st), 0.98)),
  };
}

/**
 * Zoom for project() that fits the cloud's width to the panel width and its height to the panel height,
 * taking the tighter of the two so the scale stays the same on every axis.
 */
export function fitZoom(e: PlateExtents, w: number, h: number, zoom: number): number {
  if (w <= 0 || h <= 0) return zoom;
  return (zoom * Math.min(w / 2 / e.horizontal, h / 2 / e.vertical)) / (Math.min(w, h) / 2);
}

/** The p-quantile (lower nearest rank) of values; 0 for an empty list. */
function percentile(values: number[], p: number): number {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))] ?? 0;
}

export interface DotScale {
  /** 98th-percentile enrollment over all trials; larger trials are drawn at this size. */
  e98: number;
  /** Shrinks every dot in crowded maps: clamp(sqrt(600 / n), 0.75, 1). */
  k: number;
}

export function dotScale(trials: ExplorerTrial[]): DotScale {
  const e98 = percentile(trials.map((t) => t.enrollment ?? 0), 0.98);
  const k = Math.min(1, Math.max(0.75, Math.sqrt(600 / Math.max(1, trials.length))));
  return { e98, k };
}

/** Dot radius in CSS px: grows with the square root of (capped) enrollment, scaled by crowding and perspective. */
export const dotRadius = (enrollment: number | null, f: number, s: DotScale): number =>
  (1.6 + Math.sqrt(Math.min(enrollment ?? 0, s.e98)) / 7) * s.k * f;

export function PlateCanvas({ ref, ...props }: PlateCanvasProps) {
  const [drawable] = useState(canDraw);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { trials, visible, color, emphasis, hollow, labels } = props;
  const points = useMemo(() => fitToUnit(trials), [trials]);
  const scale = useMemo(() => dotScale(trials), [trials]);
  const extents = useMemo(() => plateExtents(points, TILT), [points]);
  // Visibility, colour, emphasis and shape are resolved once per change of trials, filters or colouring;
  // the draw loop and hit testing only read these arrays.
  const mask = useMemo(() => Uint8Array.from(trials, (t) => (visible(t) ? 1 : 0)), [trials, visible]);
  const colors = useMemo(() => trials.map((t) => color(t)), [trials, color]);
  const emph = useMemo(
    () => Uint8Array.from(trials, (t, i) => (mask[i] && emphasis?.(t) ? 1 : 0)),
    [trials, mask, emphasis],
  );
  const rings = useMemo(() => Uint8Array.from(trials, (t) => (hollow?.(t) ? 1 : 0)), [trials, hollow]);
  const anchors = useMemo(
    () => clusterAnchors(trials, points, labels ?? []),
    [trials, points, labels],
  );
  const side = useMemo(() => columnSide(anchors), [anchors]);
  // The draw loop reads the latest props through this ref so it never restarts on a re-render.
  const live = useRef({ ...props, points, mask, colors, emph, rings, anchors, side, scale, extents, ink: "", plate: "" });
  const dirty = useRef(true);
  // Set by the draw loop's effect; the handle reaches the live view through it.
  const resetView = useRef<() => void>(() => undefined);
  useImperativeHandle(
    ref,
    () => ({ resetView: () => resetView.current(), focus: () => canvasRef.current?.focus() }),
    [],
  );
  useEffect(() => {
    // Theme colours are read here, once per render, never per frame.
    const css = canvasRef.current ? getComputedStyle(canvasRef.current) : null;
    const ink = css?.color || "#111";
    const plate = css?.getPropertyValue("--plate").trim() || "#fff";
    live.current = { ...props, points, mask, colors, emph, rings, anchors, side, scale, extents, ink, plate };
    dirty.current = true;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!drawable || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let angle = 0;
    /** Zoom and pan, on screen after projection (see View); never React state, so it costs no render. */
    let view: View = IDENTITY_VIEW;
    /** The gesture under way: a one-pointer turn or pan, a two-pointer pinch, or none. */
    let gesture: "none" | "turn" | "pan" | "pinch" = "none";
    const pointers = new Map<number, { x: number; y: number }>();
    let lastX = 0;
    let lastY = 0;
    let pinch = { d: 0, x: 0, y: 0 };
    let moved = 0;
    let hover: string | null = null;
    /** The last mouse or pen position, to find the dot under it again after a zoom. */
    let lastPointer: { clientX: number; clientY: number; pointerType: string } | null = null;
    let rehover = false;
    let projected: Projected[] = [];
    let frame = 0;
    let onscreen = true;
    let alive = true;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = box.width;
      h = box.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view = clampView(view, w, h);
      dirty.current = true;
    };
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const inside = (p: { sx: number; sy: number }) => p.sx >= 0 && p.sx <= w && p.sy >= 0 && p.sy <= h;

    const draw = () => {
      const { trials, points: pts, mask, colors, emph, rings, anchors, scale, extents, selected, ringColor, ink, plate } =
        live.current;
      const { labelColumn, side } = live.current;
      ctx.clearRect(0, 0, w, h);
      const zoom = fitZoom(extents, w, h, ZOOM);
      projected = viewPoints(project(pts, angle, TILT, w, h, zoom), view);
      // Painter's order: farthest (smallest depth) first.
      const order = projected.map((_, i) => i).sort((a, b) => projected[a].depth - projected[b].depth);
      const marked: number[] = [];
      for (const i of order) {
        const t = trials[i];
        if (t.nct_id === selected || t.nct_id === hover) marked.push(i);
        if (emph[i]) continue; // drawn in the emphasis pass below
        const p = projected[i];
        const r = dotRadius(t.enrollment, p.f, scale);
        // Visible dots stay a little translucent so overlaps read as density; nearer dots are firmer.
        ctx.globalAlpha = mask[i] ? Math.max(0.8, Math.min(0.9, 0.75 + 0.3 * (p.f - 1))) : 0.08;
        ctx.beginPath();
        if (rings[i]) {
          ctx.strokeStyle = colors[i];
          ctx.lineWidth = 1;
          ctx.arc(p.sx, p.sy, Math.max(1.5, r - 0.5), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = colors[i];
          ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Emphasis pass: on top of everything, opaque, never smaller than 3px, cut out from the dots below.
      ctx.globalAlpha = 1;
      for (const i of order) {
        if (!emph[i]) continue;
        const p = projected[i];
        const r = Math.max(EMPHASIS_MIN_R, dotRadius(trials[i].enrollment, p.f, scale));
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = plate;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Cluster labels: beside each condition's densest trial, projected with the cloud, in ink on a
      // plate halo, with a 1px leader back to the dot.
      // Zoomed in, a cluster whose anchor is off the canvas loses its label rather than pinning it to the edge.
      const allAt = viewPoints(project(anchors, angle, TILT, w, h, zoom), view);
      const keep = anchors.map((_, k) => k).filter((k) => view.k === 1 || inside(allAt[k]));
      if (keep.length > 0) {
        const at = keep.map((k) => allAt[k]);
        const shownAnchors = keep.map((k) => anchors[k]);
        ctx.font = LABEL_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        const widths = shownAnchors.map((a) => ctx.measureText(a.label).width);
        const items = shownAnchors.map((_, k) => ({
          sx: at[k].sx + LABEL_OFFSET + widths[k] / 2,
          sy: at[k].sy - LABEL_OFFSET,
          width: widths[k],
        }));
        // On a phone the clusters sit too close for labels beside them: stack them in the top corner away
        // from the clusters, below the play control, each with a leader down to its cluster.
        const spots: { x: number; y: number; lx?: number }[] = labelColumn
          ? columnLabels(items, w, COLUMN_TOP, side)
          : placeLabels(items, w, h);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        shownAnchors.forEach((_, k) => {
          ctx.beginPath();
          ctx.moveTo(at[k].sx, at[k].sy);
          ctx.lineTo(spots[k].lx ?? spots[k].x - widths[k] / 2 - 2, spots[k].y);
          ctx.stroke();
        });
        ctx.lineWidth = 2;
        ctx.strokeStyle = plate;
        ctx.fillStyle = ink;
        shownAnchors.forEach((a, k) => {
          ctx.strokeText(a.label, spots[k].x, spots[k].y);
          ctx.fillText(a.label, spots[k].x, spots[k].y);
        });
      }
      const ring = ringColor ?? ink;
      for (const i of marked) {
        const p = projected[i];
        const r = dotRadius(trials[i].enrollment, p.f, scale);
        ctx.strokeStyle = ring;
        ctx.lineWidth = RING_WIDTH;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, Math.max(emph[i] ? EMPHASIS_MIN_R : 0, r) + RING_GAP, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const tick = () => {
      frame = 0;
      if (!onscreen) return; // paused: resumed by the intersection observer
      // A filter change can hide the hovered trial: let go of it so its card and ring go too.
      if (hover !== null && dirty.current) {
        const i = live.current.trials.findIndex((t) => t.nct_id === hover);
        if (i < 0 || !live.current.mask[i]) setHover(null);
      }
      const turning = live.current.spinning && !live.current.reducedMotion && gesture === "none" && hover === null;
      if (turning) angle += SPIN;
      if (turning || dirty.current) {
        dirty.current = false;
        draw();
      }
      // After a zoom the dots have moved under a still pointer: find the one under it now.
      if (rehover) {
        rehover = false;
        if (lastPointer && gesture === "none") {
          const i = hitIndex(lastPointer);
          setHover(i < 0 ? null : live.current.trials[i].nct_id, lastPointer, i, true);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Offscreen (scrolled away on a long page), the loop stops; it resumes, with a redraw, on return.
    const visibility =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            const next = entries.some((e) => e.isIntersecting);
            if (next === onscreen) return;
            onscreen = next;
            if (onscreen && frame === 0) {
              dirty.current = true;
              frame = requestAnimationFrame(tick);
            } else if (!onscreen && frame !== 0) {
              cancelAnimationFrame(frame);
              frame = 0;
            }
          })
        : null;
    visibility?.observe(canvas);

    // Labels are measured in the web font: draw once more when it has loaded.
    document.fonts?.ready.then(() => {
      if (alive) dirty.current = true;
    });

    /** Index of the visible trial under the pointer, or -1. */
    const hitIndex = (e: { clientX: number; clientY: number }): number => {
      const box = canvas.getBoundingClientRect();
      return nearestIndex(projected, e.clientX - box.left, e.clientY - box.top, 12, live.current.mask);
    };
    /** The visible trial under the pointer, or null. */
    const hit = (e: PointerEvent): string | null => {
      const i = hitIndex(e);
      return i < 0 ? null : live.current.trials[i].nct_id;
    };
    /**
     * Change the hovered trial; a mouse or pen hover is reported with the dot's centre and the outer
     * edge of its hover ring, so a card can sit above it with a leader to the ring.
     */
    const setHover = (next: string | null, e?: { pointerType: string }, i = -1, again = false) => {
      if (next === hover && !(again && next !== null)) return;
      hover = next;
      dirty.current = true;
      if (next === null) {
        live.current.onHover?.(null);
      } else if (e && i >= 0 && (e.pointerType === "mouse" || e.pointerType === "pen")) {
        const { trials, emph, scale } = live.current;
        const p = projected[i];
        const r = Math.max(emph[i] ? EMPHASIS_MIN_R : 0, dotRadius(trials[i].enrollment, p.f, scale));
        live.current.onHover?.({ nct: next, x: p.sx, y: p.sy, r: r + RING_GAP + RING_WIDTH / 2 });
      }
    };

    /** Move to ``next`` (already clamped); report crossing 1x, and let a zoomed map pan under a finger. */
    const setView = (next: View) => {
      if (next.k === view.k && next.x === view.x && next.y === view.y) return;
      const crossed = next.k > 1 !== view.k > 1;
      view = next;
      dirty.current = true;
      rehover = hover !== null || lastPointer !== null;
      if (crossed) {
        canvas.style.touchAction = view.k > 1 ? "none" : "";
        live.current.onZoomChange?.(view.k);
      }
    };
    resetView.current = () => setView(IDENTITY_VIEW);
    /** Pointer position in canvas CSS px. */
    const local = (e: { clientX: number; clientY: number }) => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const pinchOf = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId ?? 0, local(e));
      setHover(null); // the card would trail behind a moving map
      canvas.setPointerCapture?.(e.pointerId);
      if (pointers.size === 2) {
        // A second finger turns the gesture into a pinch; it never selects.
        gesture = "pinch";
        pinch = pinchOf();
        moved = Infinity;
        return;
      }
      if (pointers.size > 2) return;
      // Zoomed in, a plain drag pans and Shift-drag turns; at 1x a drag turns.
      gesture = view.k > 1 && !e.shiftKey ? "pan" : "turn";
      lastX = e.clientX;
      lastY = e.clientY;
      moved = 0;
    };
    const move = (e: PointerEvent) => {
      const id = e.pointerId ?? 0;
      if (pointers.has(id)) pointers.set(id, local(e));
      if (gesture === "pinch") {
        if (pointers.size < 2) return;
        const next = pinchOf();
        let v = zoomAt(view, next.d / pinch.d, next.x, next.y, w, h);
        v = panBy(v, next.x - pinch.x, next.y - pinch.y, w, h);
        pinch = next;
        setView(v);
        return;
      }
      if (gesture === "turn" || gesture === "pan") {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (gesture === "turn") angle += dx * DRAG;
        else setView(panBy(view, dx, dy, w, h));
        moved += Math.abs(dx) + (gesture === "pan" ? Math.abs(dy) : 0);
        lastX = e.clientX;
        lastY = e.clientY;
        dirty.current = true;
        return;
      }
      if (e.pointerType === "mouse" || e.pointerType === "pen")
        lastPointer = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
      const i = hitIndex(e);
      const next = i < 0 ? null : live.current.trials[i].nct_id;
      canvas.style.cursor = next ? "pointer" : "grab";
      setHover(next, e, i);
    };
    const up = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId ?? 0)) return;
      if (pointers.size > 0) {
        // One finger of a pinch lifted: the other does nothing until it lifts too.
        if (gesture === "pinch") gesture = "none";
        return;
      }
      const was = gesture;
      gesture = "none";
      if ((was === "turn" || was === "pan") && moved < CLICK_SLOP) live.current.onSelect(hit(e));
    };
    // A cancelled gesture (scroll takeover, lost capture) only ends the drag; it never selects.
    const cancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId ?? 0);
      if (pointers.size === 0 || gesture === "pinch") gesture = "none";
    };
    const leave = () => {
      lastPointer = null;
      setHover(null);
    };
    // The wheel zooms about the pointer, only while it is over the canvas (this listener is on the
    // canvas), and never scrolls the page from here: passive: false so preventDefault holds.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h || 400 : 1;
      const rate = e.ctrlKey ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * unit * rate)));
      const p = local(e);
      setView(zoomAt(view, factor, p.x, p.y, w, h));
    };
    // With the canvas focused: + and - zoom about the centre, 0 resets.
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // the browser's own zoom
      let next: View | null = null;
      if (e.key === "+" || e.key === "=") next = zoomAt(view, KEY_ZOOM, w / 2, h / 2, w, h);
      else if (e.key === "-" || e.key === "_") next = zoomAt(view, 1 / KEY_ZOOM, w / 2, h / 2, w, h);
      else if (e.key === "0") next = IDENTITY_VIEW;
      if (next === null) return;
      e.preventDefault();
      setView(next);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("keydown", key);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      visibility?.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("keydown", key);
      resetView.current = () => undefined;
    };
  }, [drawable]);

  if (!drawable) {
    return (
      <p className="plate-fallback">
        This browser cannot draw the 3D map. The same trials are in the{" "}
        <a href="#/trials">trial list</a>.
      </p>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      className="plate-canvas"
      role="img"
      tabIndex={0}
      aria-label={`3D map of ${trials.length} trials. Scroll or press + and − to zoom, 0 to reset.`}
    />
  );
}
