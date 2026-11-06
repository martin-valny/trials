import { useEffect, useMemo, useRef, useState } from "react";
import { nearestIndex, project, type Projected } from "../../lib/explorer";
import type { ExplorerTrial } from "../../types";

export interface PlateCanvasProps {
  trials: ExplorerTrial[];
  visible: (t: ExplorerTrial) => boolean;
  color: (t: ExplorerTrial) => string;
  selected: string | null;
  onSelect: (nct: string | null) => void;
  reducedMotion: boolean;
  /** Ring drawn around the selected and hovered dot; defaults to the canvas's CSS colour. */
  ringColor?: string;
}

const SPIN = 0.0022; // radians per frame, as in the approved plate
const TILT = 0.32;
const ZOOM = 0.9; // of the half-size of the panel, after fitting the cloud's in-plane spread to the unit circle
const DRAG = 0.008; // radians per dragged pixel
const CLICK_SLOP = 4; // px of pointer travel still counted as a click

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
  /** Shrinks every dot in crowded maps: clamp(sqrt(600 / n), 0.55, 1). */
  k: number;
}

export function dotScale(trials: ExplorerTrial[]): DotScale {
  const e98 = percentile(trials.map((t) => t.enrollment ?? 0), 0.98);
  const k = Math.min(1, Math.max(0.55, Math.sqrt(600 / Math.max(1, trials.length))));
  return { e98, k };
}

/** Dot radius in CSS px: grows with the square root of (capped) enrollment, scaled by crowding and perspective. */
export const dotRadius = (enrollment: number | null, f: number, s: DotScale): number =>
  (1.6 + Math.sqrt(Math.min(enrollment ?? 0, s.e98)) / 7) * s.k * f;

export function PlateCanvas(props: PlateCanvasProps) {
  const [drawable] = useState(canDraw);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { trials, visible, color } = props;
  const points = useMemo(() => fitToUnit(trials), [trials]);
  const scale = useMemo(() => dotScale(trials), [trials]);
  const extents = useMemo(() => plateExtents(points, TILT), [points]);
  // Visibility and colour are resolved once per change of trials, filters or colouring;
  // the draw loop and hit testing only read these arrays.
  const mask = useMemo(() => Uint8Array.from(trials, (t) => (visible(t) ? 1 : 0)), [trials, visible]);
  const colors = useMemo(() => trials.map((t) => color(t)), [trials, color]);
  // The draw loop reads the latest props through this ref so it never restarts on a re-render.
  const live = useRef({ ...props, points, mask, colors, scale, extents });
  const dirty = useRef(true);
  useEffect(() => {
    live.current = { ...props, points, mask, colors, scale, extents };
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
    let dragging = false;
    let lastX = 0;
    let moved = 0;
    let hover: string | null = null;
    let projected: Projected[] = [];
    let frame = 0;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = box.width;
      h = box.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty.current = true;
    };
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const draw = () => {
      const { trials, points: pts, mask, colors, scale, extents, selected, ringColor } = live.current;
      ctx.clearRect(0, 0, w, h);
      projected = project(pts, angle, TILT, w, h, fitZoom(extents, w, h, ZOOM));
      // Painter's order: farthest (smallest depth) first.
      const order = projected.map((_, i) => i).sort((a, b) => projected[a].depth - projected[b].depth);
      const ring = ringColor ?? getComputedStyle(canvas).color;
      for (const i of order) {
        const t = trials[i];
        const p = projected[i];
        const r = dotRadius(t.enrollment, p.f, scale);
        // Visible dots stay a little translucent so overlaps read as density; nearer dots are firmer.
        ctx.globalAlpha = mask[i] ? Math.max(0.6, Math.min(0.9, 0.75 + 0.3 * (p.f - 1))) : 0.08;
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fill();
        if (t.nct_id === selected || t.nct_id === hover) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = ring;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = () => {
      const spinning = !dragging && !live.current.reducedMotion;
      if (spinning) angle += SPIN;
      if (spinning || dirty.current) {
        dirty.current = false;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    /** The visible trial under the pointer, or null. */
    const hit = (e: PointerEvent): string | null => {
      const box = canvas.getBoundingClientRect();
      const { trials, mask } = live.current;
      const i = nearestIndex(projected, e.clientX - box.left, e.clientY - box.top, 12, mask);
      return i < 0 ? null : trials[i].nct_id;
    };

    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      moved = 0;
      canvas.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (dragging) {
        angle += (e.clientX - lastX) * DRAG;
        moved += Math.abs(e.clientX - lastX);
        lastX = e.clientX;
        dirty.current = true;
        return;
      }
      const next = hit(e);
      canvas.style.cursor = next ? "pointer" : "grab";
      if (next !== hover) {
        hover = next;
        dirty.current = true;
      }
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (moved < CLICK_SLOP) live.current.onSelect(hit(e));
    };
    // A cancelled gesture (scroll takeover, lost capture) only ends the drag; it never selects.
    const cancel = () => {
      dragging = false;
    };
    const leave = () => {
      if (hover !== null) {
        hover = null;
        dirty.current = true;
      }
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("pointerleave", leave);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("pointerleave", leave);
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
      aria-label={`3D map of ${props.trials.length} trials`}
    />
  );
}
