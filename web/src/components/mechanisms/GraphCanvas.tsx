import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { clampView, IDENTITY_VIEW, panBy, zoomAt, type Palette, type View } from "../../lib/explorer";
import { chain, drugNodeId, findMatches, neighbours, nodeShare, shareColor, type Match } from "../../lib/graph";
import type { GraphFile, GraphNode } from "../../types";

/** Canvas px kept clear around the layout, so edge nodes and their labels stay inside. */
export const GRAPH_PAD = 28;
const CLICK_SLOP = 4;
const HIT_SLOP = 5;
const WHEEL_ZOOM = 0.0015;
const PINCH_WHEEL_ZOOM = 0.01;
const KEY_ZOOM = 1.4;
const MAX_LABELS = 32;
const LABEL_FONT = 11;

/** A node's spot on a w x h canvas at 1x: the layout's [-1, 1] square stretched to the padded frame. */
export function placeNode(n: Pick<GraphNode, "x" | "y">, w: number, h: number): { x: number; y: number } {
  return {
    x: GRAPH_PAD + ((n.x + 1) / 2) * Math.max(1, w - 2 * GRAPH_PAD),
    y: GRAPH_PAD + ((1 - n.y) / 2) * Math.max(1, h - 2 * GRAPH_PAD),
  };
}

/** Node radius: area by trials reaching the node, 3 to 12px. */
export const nodeRadius = (n: number, maxN: number): number => 3 + 9 * Math.sqrt(Math.max(0, n) / Math.max(1, maxN));

export interface GraphCanvasHandle {
  resetView(): void;
}

export interface GraphCanvasProps {
  graph: GraphFile;
  /** The focused node (its chain lit), or null. */
  focus: string | null;
  onFocus(id: string | null): void;
  /** Nodes the filtered trials reach (full ink), or null when nothing is narrowed (all at rest). */
  lit: Set<string> | null;
  /** Nodes on a succeeded path (1b), drawn in the success red where lit. */
  red: Set<string>;
  minGroup: number;
  palette: Palette;
  /** The highest defined share, the red end of the fill scale. */
  topShare: number;
  ref?: Ref<GraphCanvasHandle>;
}

function canDraw(): boolean {
  try {
    return document.createElement("canvas").getContext("2d") !== null;
  } catch {
    return false;
  }
}

type Shape = "circle" | "square" | "diamond";
const shapeOf = (n: GraphNode): Shape => (n.kind === "drug" ? "circle" : n.kind === "target" ? "square" : "diamond");

function tracePath(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number) {
  ctx.beginPath();
  if (shape === "circle") ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (shape === "square") {
    const s = r * 0.9;
    ctx.rect(x - s, y - s, 2 * s, 2 * s);
  } else {
    const s = r * 1.2;
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
  }
}

/**
 * The Targeted drugs graph (spec 2026-11-06 §7.2): drugs (circles) → targets (squares) → pathways
 * (diamonds) at their seeded positions. At rest all muted; hover lights a node and its neighbours;
 * a click focuses its chain; Escape or a click on empty space clears; filters light up instead of hiding.
 */
export function GraphCanvas({ ref, ...props }: GraphCanvasProps) {
  const [drawable] = useState(canDraw);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { graph } = props;
  const maxN = useMemo(() => Math.max(1, ...graph.nodes.map((n) => n.n)), [graph]);
  const live = useRef({ ...props, maxN, ink: "#111", plate: "#fff", muted: "#5b6268", font: "system-ui" });
  const schedule = useRef<() => void>(() => undefined);
  const resetView = useRef<() => void>(() => undefined);
  useImperativeHandle(ref, () => ({ resetView: () => resetView.current() }), []);

  useEffect(() => {
    const css = canvasRef.current ? getComputedStyle(canvasRef.current) : null;
    live.current = {
      ...props,
      maxN,
      ink: css?.color || "#111",
      plate: css?.getPropertyValue("--plate").trim() || "#fff",
      muted: css?.getPropertyValue("--muted").trim() || "#5b6268",
      font: css?.fontFamily || "system-ui",
    };
    schedule.current();
  });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!drawable || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let view: View = IDENTITY_VIEW;
    let hover: string | null = null;
    let frame = 0;
    let down: { x: number; y: number; moved: number } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = { d: 0, x: 0, y: 0 };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = box.width;
      h = box.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view = clampView(view, w, h);
      request();
    };
    const at = (n: GraphNode) => {
      const p = placeNode(n, w, h);
      return { x: view.k * p.x + view.x, y: view.k * p.y + view.y };
    };

    const draw = () => {
      frame = 0;
      const { graph, focus, lit, red, minGroup, palette, topShare, maxN, ink, plate, muted, font } = live.current;
      ctx.clearRect(0, 0, w, h);
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      const pos = new Map(graph.nodes.map((n) => [n.id, at(n)]));
      // What is lit: a hovered node and its neighbours, else the focused chain, else the filters' reach.
      const known = (id: string | null) => (id !== null && byId.has(id) ? id : null);
      const hovered = known(hover);
      const focused = known(focus);
      const active = hovered ? neighbours(graph, hovered) : focused ? chain(graph, focused) : lit;
      // Succeeded paths stay red only where they are lit, and only when the filters (not hover) light.
      const reds = hovered ? new Set<string>() : new Set([...red].filter((id) => !active || active.has(id)));
      const on = (id: string) => active === null || active.has(id);

      // Edges: hairlines, faint unless both ends are lit. Shared-gene links are dotted context.
      ctx.lineCap = "round";
      for (const pass of [0, 1] as const) {
        for (const e of graph.edges) {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) continue;
          const both = active !== null && active.has(e.source) && active.has(e.target);
          if ((pass === 1) !== both) continue;
          const shares = e.kind === "shares_genes";
          const isRed = !shares && reds.has(e.source) && reds.has(e.target);
          ctx.globalAlpha = both ? 1 : active === null ? (shares ? 0.18 : 0.3) : 0.07;
          ctx.strokeStyle = isRed ? palette.succeeded : both ? ink : muted;
          ctx.lineWidth = isRed ? 1.5 : 1;
          const curated = byId.get(e.target)?.source === "curated" || byId.get(e.source)?.source === "curated";
          const go = e.source_db === "go";
          ctx.setLineDash(shares ? [1, 3] : curated ? [4, 3] : go ? [1.5, 2] : []);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // Nodes: faded context first, lit on top, largest first so small nodes stay visible.
      const order = [...graph.nodes].sort((a, b) => Number(on(a.id)) - Number(on(b.id)) || b.n - a.n);
      for (const n of order) {
        const p = pos.get(n.id)!;
        const r = nodeRadius(n.n, maxN);
        const lit1 = active !== null && active.has(n.id);
        const alpha = active === null ? 0.6 : lit1 ? 1 : 0.14;
        const share = nodeShare(n, minGroup);
        const shape = shapeOf(n);
        ctx.globalAlpha = alpha;
        tracePath(ctx, shape, p.x, p.y, r);
        if (share !== null) {
          ctx.fillStyle = shareColor(share, topShare, palette);
          ctx.fill();
        } else {
          // Too few pool trials to tell: hollow, on the plate (shape, not shade).
          ctx.fillStyle = plate;
          ctx.fill();
        }
        const isRed = reds.has(n.id);
        ctx.strokeStyle = isRed ? palette.succeeded : lit1 ? ink : muted;
        ctx.lineWidth = isRed || n.id === focused || n.id === hovered ? 1.75 : 1;
        if (n.source === "curated") ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (n.source === "go") {
          // The GO marker: a second, inner diamond.
          tracePath(ctx, "diamond", p.x, p.y, r * 0.45);
          ctx.stroke();
        }
      }

      // Labels: top-level pathways at rest; lit nodes (the hovered or focused one first, then by size)
      // when something is lit. Greedy: a label that would overlap one already set is left out.
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const wanted =
        active === null
          ? graph.nodes.filter((n) => n.top_level)
          : graph.nodes
              .filter((n) => active.has(n.id))
              .sort(
                (a, b) =>
                  Number(b.id === hovered || b.id === focused) - Number(a.id === hovered || a.id === focused) ||
                  b.n - a.n,
              )
              .slice(0, MAX_LABELS);
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const n of wanted) {
        const p = pos.get(n.id)!;
        const r = nodeRadius(n.n, maxN);
        const strong = n.id === hovered || n.id === focused;
        ctx.font = `${strong ? 700 : 400} ${LABEL_FONT}px ${font}`;
        let text = n.source === "curated" ? `${n.label} (curated)` : n.label;
        let tw = ctx.measureText(text).width;
        // The side with room, else the roomier side with the label cut to fit (never off the canvas).
        const roomR = w - 4 - (p.x + r + 4);
        const roomL = p.x - r - 4 - 4;
        const right = tw <= roomR || (tw > roomL && roomR >= roomL);
        const room = right ? roomR : roomL;
        if (tw > room) {
          while (text.length > 1 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1);
          text = `${text.trimEnd()}…`;
          tw = ctx.measureText(text).width;
        }
        const x = right ? p.x + r + 4 : p.x - r - 4 - tw;
        const box = { x0: x - 2, y0: p.y - 8, x1: x + tw + 2, y1: p.y + 8 };
        if (!strong && placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
        if (box.x1 < 0 || box.x0 > w || box.y1 < 0 || box.y0 > h) continue;
        placed.push(box);
        ctx.globalAlpha = active === null ? 0.75 : 1;
        ctx.textAlign = "left";
        ctx.strokeStyle = plate;
        ctx.lineWidth = 3;
        ctx.strokeText(text, x, p.y);
        ctx.fillStyle = reds.has(n.id) ? palette.succeeded : active === null ? muted : ink;
        ctx.fillText(text, x, p.y);
      }
      ctx.globalAlpha = 1;
    };
    function request() {
      if (frame === 0) frame = requestAnimationFrame(draw);
    }
    schedule.current = request;

    const setView = (next: View) => {
      if (next.k === view.k && next.x === view.x && next.y === view.y) return;
      const crossed = next.k > 1 !== view.k > 1;
      view = next;
      if (crossed) canvas.style.touchAction = view.k > 1 ? "none" : "";
      request();
    };
    resetView.current = () => setView(IDENTITY_VIEW);

    const local = (e: { clientX: number; clientY: number }) => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    /** The node under a canvas point: the nearest whose shape (plus a little slop) contains it. */
    const hit = (x: number, y: number): string | null => {
      const { graph, maxN } = live.current;
      let best: string | null = null;
      let bestD = Infinity;
      for (const n of graph.nodes) {
        const p = at(n);
        const r = nodeRadius(n.n, maxN) * (n.kind === "pathway" ? 1.2 : 1) + HIT_SLOP;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d <= r * r && d < bestD) {
          bestD = d;
          best = n.id;
        }
      }
      return best;
    };
    const setHover = (id: string | null) => {
      if (id === hover) return;
      hover = id;
      canvas.style.cursor = id ? "pointer" : "grab";
      request();
    };
    const pinchOf = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    const onDown = (e: PointerEvent) => {
      const p = local(e);
      pointers.set(e.pointerId ?? 0, p);
      canvas.setPointerCapture?.(e.pointerId);
      if (pointers.size === 2) {
        pinch = pinchOf();
        down = null;
        return;
      }
      down = { ...p, moved: 0 };
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const id = e.pointerId ?? 0;
      if (pointers.has(id)) pointers.set(id, p);
      if (pointers.size === 2) {
        const next = pinchOf();
        setView(panBy(zoomAt(view, next.d / pinch.d, next.x, next.y, w, h), next.x - pinch.x, next.y - pinch.y, w, h));
        pinch = next;
        return;
      }
      if (down) {
        const dx = p.x - down.x;
        const dy = p.y - down.y;
        down = { x: p.x, y: p.y, moved: down.moved + Math.abs(dx) + Math.abs(dy) };
        if (view.k > 1) setView(panBy(view, dx, dy, w, h));
        return;
      }
      if (e.pointerType === "mouse" || e.pointerType === "pen") setHover(hit(p.x, p.y));
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId ?? 0)) return;
      if (pointers.size > 0) return;
      const was = down;
      down = null;
      if (was && was.moved < CLICK_SLOP) {
        const p = local(e);
        const id = hit(p.x, p.y);
        if (e.pointerType !== "mouse" && e.pointerType !== "pen") setHover(null);
        // A node focuses its chain; empty space clears the focus.
        live.current.onFocus(id);
      }
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId ?? 0);
      down = null;
    };
    const onLeave = () => setHover(null);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h || 400 : 1;
      const rate = e.ctrlKey ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * unit * rate)));
      const p = local(e);
      setView(zoomAt(view, factor, p.x, p.y, w, h));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let next: View | null = null;
      if (e.key === "Escape") {
        if (live.current.focus === null) return;
        e.preventDefault();
        live.current.onFocus(null);
        return;
      }
      if (e.key === "+" || e.key === "=") next = zoomAt(view, KEY_ZOOM, w / 2, h / 2, w, h);
      else if (e.key === "-" || e.key === "_") next = zoomAt(view, 1 / KEY_ZOOM, w / 2, h / 2, w, h);
      else if (e.key === "0") next = IDENTITY_VIEW;
      if (next === null) return;
      e.preventDefault();
      setView(next);
    };

    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      schedule.current = () => undefined;
      resetView.current = () => undefined;
    };
  }, [drawable]);

  const counts = useMemo(() => {
    const c = { drug: 0, target: 0, pathway: 0 };
    for (const n of graph.nodes) c[n.kind]++;
    return c;
  }, [graph]);

  if (!drawable) {
    return (
      <p className="graph-fallback">
        This browser cannot draw the graph. Find a drug, target or pathway above to read its facts.
      </p>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      role="img"
      tabIndex={0}
      aria-label={`Mechanism graph of ${counts.drug} drugs, ${counts.target} targets and ${counts.pathway} pathways. Click a node to focus its chain, Escape clears. Scroll or press + and − to zoom, 0 to reset.`}
    />
  );
}

/**
 * Find a node: a combobox over node labels. Arrow keys move through the matches, Enter or a click
 * selects one (focusing it on the graph and opening its panel).
 */
export function GraphSearch({ graph, onSelect }: { graph: GraphFile; onSelect(id: string): void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = useMemo(() => findMatches(graph, q), [graph, q]);
  const open = matches.length > 0;
  // A dropped drug selects its drug id too: the page then says why it is not drawn.
  const choose = (m: Match) => {
    setQ("");
    setActive(0);
    onSelect(m.node ? m.node.id : drugNodeId(m.dropped!.drug));
  };
  const kindWord = (m: Match) => {
    const n = m.node;
    if (!n) return "not drawn";
    return n.kind === "drug" ? "drug" : n.kind === "target" ? "target" : n.source === "curated" ? "curated" : "pathway";
  };

  return (
    <div className="tb-find graph-search">
      <svg className="find-glyph" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        <circle cx="5" cy="5" r="3.75" />
        <path d="M7.75 7.75 11 11" />
      </svg>
      <input
        type="search"
        role="combobox"
        aria-label="Find a drug, target or pathway"
        placeholder="Find a drug, target or pathway"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${Math.min(active, matches.length - 1)}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp" && open) {
            e.preventDefault();
            setActive((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(matches[Math.min(active, matches.length - 1)]);
          } else if (e.key === "Escape" && q) {
            e.preventDefault();
            setQ("");
          }
        }}
      />
      {open ? (
        <ul className="graph-matches" role="listbox" id={listId} aria-label="Matching nodes">
          {matches.map((m, i) => (
            <li
              key={m.node ? m.node.id : `dropped:${m.dropped!.drug}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(m)}
            >
              <span className="match-label">{m.node ? m.node.label : m.dropped!.drug}</span>
              <span className="match-kind">{kindWord(m)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
