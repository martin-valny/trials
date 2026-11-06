import { useEffect, useMemo, useRef, useState } from "react";
import { clusterAnchors, columnLabels, columnSide, nearestIndex, placeLabels, project, type Projected } from "../../lib/explorer";
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

export function PlateCanvas(props: PlateCanvasProps) {
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
    let dragging = false;
    let lastX = 0;
    let moved = 0;
    let hover: string | null = null;
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
      dirty.current = true;
    };
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const draw = () => {
      const { trials, points: pts, mask, colors, emph, rings, anchors, scale, extents, selected, ringColor, ink, plate } =
        live.current;
      const { labelColumn, side } = live.current;
      ctx.clearRect(0, 0, w, h);
      const zoom = fitZoom(extents, w, h, ZOOM);
      projected = project(pts, angle, TILT, w, h, zoom);
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
      if (anchors.length > 0) {
        const at = project(anchors, angle, TILT, w, h, zoom);
        ctx.font = LABEL_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        const widths = anchors.map((a) => ctx.measureText(a.label).width);
        const items = anchors.map((_, k) => ({
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
        anchors.forEach((_, k) => {
          ctx.beginPath();
          ctx.moveTo(at[k].sx, at[k].sy);
          ctx.lineTo(spots[k].lx ?? spots[k].x - widths[k] / 2 - 2, spots[k].y);
          ctx.stroke();
        });
        ctx.lineWidth = 2;
        ctx.strokeStyle = plate;
        ctx.fillStyle = ink;
        anchors.forEach((a, k) => {
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
      const turning = live.current.spinning && !live.current.reducedMotion && !dragging && hover === null;
      if (turning) angle += SPIN;
      if (turning || dirty.current) {
        dirty.current = false;
        draw();
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
    const hitIndex = (e: PointerEvent): number => {
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
    const setHover = (next: string | null, e?: PointerEvent, i = -1) => {
      if (next === hover) return;
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

    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      moved = 0;
      setHover(null); // the card would trail behind a turning map
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
      const i = hitIndex(e);
      const next = i < 0 ? null : live.current.trials[i].nct_id;
      canvas.style.cursor = next ? "pointer" : "grab";
      setHover(next, e, i);
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
    const leave = () => setHover(null);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("pointerleave", leave);

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
