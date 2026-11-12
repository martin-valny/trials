import { useEffect, useMemo, useRef, useState } from "react";
import { buildViews, type DotTarget, type IntroView, type Paint, type ViewKey, type ViewLabel } from "../../lib/intro";
import type { RecordedPair } from "../../lib/diligenceRelease";
import type { IntroFile } from "../../types";
import "./intro.css";

export interface Pos { x: number; y: number; a: number; r: number }

const MOVE_MS = 1100;
const STAGGER_MS = 320;
const LABEL_AT = 700;
const LABEL_FADE = 400;
const SETTLE_MS = Math.max(MOVE_MS + STAGGER_MS, LABEL_AT + LABEL_FADE);
const RINGS = new Set<Paint>(["run", "unk", "changed-ring", "multi"]);
const AP_TOKEN: Record<string, string> = { targeted: "--run", cell: "--ap-cell", plasma: "--ap-plasma", tolerisation: "--ap-tolerisation", diffuse: "--ap-diffuse", nondrug: "--ap-nondrug", unclassified: "--fin" };
const PAINT_TOKEN: Record<string, string> = { adv: "--red", run: "--run", stop: "--stop", fin: "--fin", unk: "--unk", ghost: "--fin", changed: "--ink", "changed-ring": "--ink", multi: "--ink" };
const FONT = (weight: number, size: number) => `${weight} ${size}px "Hanken Grotesk", system-ui, sans-serif`;

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Where a transition starts: the dots' current positions when the count still matches (a resize or view change keeps them), else the new targets. */
export function nextFrom(prev: Pos[] | null, targets: DotTarget[]): Pos[] {
  if (prev && prev.length === targets.length) return prev.map((p) => ({ ...p }));
  return targets.map(({ x, y, a, r }) => ({ x, y, a, r }));
}

/** Fit a label inside the canvas at its own size (12px floor): truncate with an ellipsis, measured with the ellipsis included. */
export function fit(ctx: CanvasRenderingContext2D, l: ViewLabel, w: number): { text: string; size: number } {
  const align = l.align ?? "left";
  const room = Math.max(0, align === "center" ? 2 * Math.min(l.x, w - l.x) : align === "right" ? l.x : w - l.x);
  const size = l.size ?? 12;
  const width = (t: string) => { ctx.font = FONT(l.weight ?? 400, size); return ctx.measureText(t).width; };
  if (width(l.text) <= room) return { text: l.text, size };
  let text = l.text;
  while (text.length > 0 && width(`${text.trimEnd()}…`) > room) text = text.slice(0, -1);
  return { text: `${text.trimEnd()}…`, size };
}

export function DotCanvas({ file, pairs, active, reduced, label }: { file: IntroFile; pairs: RecordedPair[]; active: ViewKey; reduced: boolean; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const views = useMemo(() => (size.w > 0 && size.h > 0 ? buildViews(file, pairs, size.w, size.h) : null), [file, pairs, size]);
  const anim = useRef<{ cur: Pos[]; from: Pos[]; t0: number; view: ViewKey } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const set = (w: number, h: number) => setSize((s) => (s.w === Math.floor(w) && s.h === Math.floor(h) ? s : { w: Math.floor(w), h: Math.floor(h) }));
    if (typeof ResizeObserver !== "function") { set(el.clientWidth, el.clientHeight); return; }
    const ro = new ResizeObserver(([e]) => e && set(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new view or layout starts a transition from wherever the dots are now.
  useEffect(() => {
    if (!views) return;
    const targets = views[active].dots;
    const prev = anim.current;
    const from = nextFrom(prev ? prev.cur : null, targets);
    anim.current = { cur: prev && prev.cur.length === targets.length ? prev.cur : from.map((p) => ({ ...p })), from, t0: prev && !reduced ? performance.now() : 0, view: active };
  }, [views, active, reduced]);

  useEffect(() => {
    const canvas = cvs.current;
    const ctx = canvas?.getContext("2d");
    if (!views || !canvas || !ctx) return;
    const cache = new WeakMap<ViewLabel, { text: string; size: number }>();
    let raf = 0;
    const wake = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const draw = (now: number) => {
      raf = 0;
      const a = anim.current;
      if (!a) return;
      // Keep animating until the move and the label fade are done; after that only a wake-up repaints.
      if (a.t0 !== 0 && !reduced && now - a.t0 < SETTLE_MS) raf = requestAnimationFrame(draw);
      const { w, h } = size;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cs = getComputedStyle(document.documentElement);
      const toks = new Map<string, string>();
      const tok = (name: string) => { let v = toks.get(name); if (v === undefined) { v = cs.getPropertyValue(name).trim(); toks.set(name, v); } return v; };
      const colour = (p: Paint) => tok(p.startsWith("ap:") ? (AP_TOKEN[p.slice(3)] ?? "--fin") : (PAINT_TOKEN[p] ?? "--fin"));
      const view: IntroView = views[a.view];
      for (let i = 0; i < view.dots.length; i++) {
        const tg = view.dots[i], f = a.from[i], cur = a.cur[i];
        const delay = reduced ? 0 : (tg.x / Math.max(1, w)) * STAGGER_MS;
        const e = ease(a.t0 === 0 ? 1 : clamp01((now - a.t0 - delay) / MOVE_MS));
        cur.x = f.x + (tg.x - f.x) * e; cur.y = f.y + (tg.y - f.y) * e; cur.a = f.a + (tg.a - f.a) * e; cur.r = f.r + (tg.r - f.r) * e;
        ctx.globalAlpha = cur.a;
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, Math.max(0.6, cur.r), 0, Math.PI * 2);
        if (RINGS.has(tg.paint)) { ctx.strokeStyle = colour(tg.paint); ctx.lineWidth = 1.2; ctx.stroke(); }
        else { ctx.fillStyle = colour(tg.paint); ctx.fill(); }
      }
      ctx.globalAlpha = a.t0 === 0 || reduced ? 1 : clamp01((now - a.t0 - LABEL_AT) / LABEL_FADE);
      for (const r of view.rules) {
        ctx.strokeStyle = tok("--ink");
        ctx.lineWidth = 1;
        ctx.setLineDash(r.kind === "tick" ? [3, 3] : []);
        ctx.beginPath();
        if (r.kind === "axis") { ctx.moveTo(r.x, r.y + 0.5); ctx.lineTo(r.x + r.length, r.y + 0.5); }
        else { ctx.moveTo(r.x, r.y + 6); ctx.lineTo(r.x, r.y - r.length); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const l of view.labels) {
        let f = cache.get(l);
        if (!f) { f = fit(ctx, l, w); cache.set(l, f); }
        ctx.font = FONT(l.weight ?? 400, f.size);
        ctx.textAlign = l.align ?? "left";
        ctx.fillStyle = tok(l.tone === "muted" ? "--muted" : "--ink");
        ctx.fillText(f.text, l.x, l.y);
      }
      ctx.globalAlpha = 1;
    };
    wake();
    // Idle repaints: a theme change, or a pixel-ratio change (window moved between screens).
    const mo = new MutationObserver(wake);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const dpr = window.devicePixelRatio || 1;
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(`(resolution: ${dpr}dppx)`) : null;
    mq?.addEventListener?.("change", wake);
    return () => { cancelAnimationFrame(raf); mo.disconnect(); mq?.removeEventListener?.("change", wake); };
  }, [views, size, reduced, active]);

  return (
    <div className="dot-canvas" ref={wrap}>
      <canvas ref={cvs} role="img" aria-label={label} />
    </div>
  );
}
