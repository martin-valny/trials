import type { ChangeBin, IntroFile, Outcome, RowState } from "../types";
import type { RecordedPair } from "./diligenceRelease";

export type ViewKey = "all" | "pipeline" | "diligence" | "watchlist" | "approaches" | "changes" | "trials";
export type Paint = RowState | "ghost" | "changed" | "changed-ring" | "multi" | `ap:${string}`;
export interface DotTarget { x: number; y: number; a: number; r: number; paint: Paint }
export interface ViewLabel { text: string; x: number; y: number; align?: CanvasTextAlign; weight?: 400 | 700; size?: number; tone?: "ink" | "muted" }
/** axis: horizontal line from x; tick: dashed vertical line going up from (x, y). */
export interface ViewRule { kind: "axis" | "tick"; x: number; y: number; length: number }
export interface IntroView { dots: DotTarget[]; labels: ViewLabel[]; rules: ViewRule[] }

export const OUTCOME_PAINT: Record<Outcome, RowState> = { succeeded: "adv", running: "run", stopped: "stop", completed_unknown: "fin", unknown: "unk" };

const VIEW_ORDER: ViewKey[] = ["all", "pipeline", "diligence", "watchlist", "approaches", "changes", "trials"];
export const VIEW_TEXT: Record<ViewKey, { name: string; to: string; caption: string }> = {
  all: { name: "All trials", to: "/explore", caption: "Every trial is a dot, placed by what it studies. Similar trials sit together." },
  pipeline: { name: "Pipeline", to: "/pipeline", caption: "Trials sorted onto their drug target's row and phase. Red ones moved on to the next phase." },
  diligence: { name: "Diligence", to: "/diligence", caption: "Targets an AI agent has written a checked memo on, each with its trials in that disease." },
  watchlist: { name: "Watchlist", to: "/watchlist", caption: "Running trials by their estimated chance of stopping early, against the typical rate." },
  approaches: { name: "Approaches", to: "/approaches", caption: "Every trial by how its treatment works, from targeted drugs to non-drug care." },
  changes: { name: "Changes", to: "/changes", caption: "Trials whose registry record changed this week, sorted by what changed." },
  trials: { name: "Trials", to: "/trials", caption: "Every trial by the year it started. Open any one for its full record and history." },
};

const MULTI_LABEL = "More than one approach";
const APPROACH_NOTE = "Trials in several approaches are under More than one; the Approaches page counts them in each.";
const GOLDEN = 2.39996;
const num = (n: number) => n.toLocaleString("en-GB");
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Same rule as knownPairs, from intro data: the target is a row, and the disease is "all" or sits on a trial marked on that row. */
export function introPairs(file: IntroFile, pairs: RecordedPair[]): RecordedPair[] {
  const rowIdx = new Map(file.rows.map((r, i) => [r.id, i]));
  return pairs.filter(({ target, disease }) => {
    const ri = rowIdx.get(target);
    if (ri === undefined) return false;
    if (disease === "all") return true;
    return file.trials.marks.some((ms, i) => ms.some((m) => m[0] === ri) && file.trials.dz[i].includes(disease));
  });
}

/** Explorer x/y at rest: 1st-99th percentile box scaled to 0.82 of the fit, then collision relaxation on a spatial hash. */
export function cloudPositions(file: IntroFile, w: number, h: number): { x: number; y: number }[] {
  const { x, y } = file.trials;
  const n = x.length;
  if (n === 0) return [];
  const q = (a: number[], p: number) => [...a].sort((u, v) => u - v)[Math.floor(p * (a.length - 1))];
  const [x0, x1, y0, y1] = [q(x, 0.01), q(x, 0.99), q(y, 0.01), q(y, 0.99)];
  const sc = Math.min((w * 0.92) / Math.max(1e-9, x1 - x0), (h * 0.9) / Math.max(1e-9, y1 - y0));
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const pts = x.map((_, i) => ({ x: w / 2 + (x[i] - cx) * sc * 0.82, y: h / 2 - (y[i] - cy) * sc * 0.82 }));
  const md = clamp(Math.sqrt((0.3 * w * h) / n), 4, 7);
  for (let it = 0; it < 60; it++) {
    const grid = new Map<string, number[]>();
    pts.forEach((p, i) => {
      const k = `${Math.floor(p.x / md)},${Math.floor(p.y / md)}`;
      const cell = grid.get(k);
      if (cell) cell.push(i);
      else grid.set(k, [i]);
    });
    pts.forEach((p, i) => {
      const [gx, gy] = [Math.floor(p.x / md), Math.floor(p.y / md)];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        if (j <= i) continue;
        const o = pts[j];
        let [vx, vy] = [o.x - p.x, o.y - p.y];
        let dd = Math.hypot(vx, vy);
        if (dd >= md) continue;
        if (dd < 1e-3) { vx = Math.cos(i + j); vy = Math.sin(i + j); dd = 1; }
        const push = (md - dd) / 2 / dd;
        p.x -= vx * push; p.y -= vy * push; o.x += vx * push; o.y += vy * push;
      }
    });
  }
  return pts.map((p) => ({ x: clamp(p.x, 4, w - 4), y: clamp(p.y, 4, h - 4) }));
}

const paintOf = (file: IntroFile, i: number): RowState => OUTCOME_PAINT[file.trials.outcome[i]];

function pipelineView(file: IntroFile, rest: (i: number) => DotTarget, w: number, h: number): IntroView {
  const n = file.trials.id.length;
  const dots = Array.from({ length: n }, (_, i) => rest(i));
  const counts = file.rows.map(() => 0);
  for (const ms of file.trials.marks) for (const m of ms) counts[m[0]]++;
  const order = file.rows.map((_, i) => i).filter((i) => counts[i] > 0).sort((a, b) => counts[b] - counts[a] || a - b);
  const top = 40, labW = Math.min(130, w * 0.22);
  const nRows = Math.min(order.length, Math.max(1, Math.floor((h - top) / 26)));
  const shown = order.slice(0, nRows);
  const rank = new Map(shown.map((ri, k) => [ri, k]));
  const rowH = (h - top) / Math.max(1, nRows), colW = (w - labW) / 4;
  const labels: ViewLabel[] = ["Phase 1", "Phase 2", "Phase 3", "Approved use"].map((text, j) => ({ text, x: labW + colW * j + 6, y: 16, tone: "muted", size: 12 }));
  const cells = new Map<string, { i: number; st: RowState }[]>();
  for (let i = 0; i < n; i++) {
    let best: { rk: number; c: number; st: RowState } | null = null;
    for (const [ri, c, st] of file.trials.marks[i]) {
      const rk = rank.get(ri);
      if (rk !== undefined && (!best || rk < best.rk)) best = { rk, c, st };
    }
    if (!best) continue;
    const key = `${best.rk}:${clamp(best.c, 1, 4) - 1}`;
    const cell = cells.get(key);
    if (cell) cell.push({ i, st: best.st });
    else cells.set(key, [{ i, st: best.st }]);
  }
  shown.forEach((ri, rk) => labels.push({ text: file.rows[ri].label, x: 0, y: top + rk * rowH + rowH / 2 + 4, weight: 700, size: 13 }));
  for (const [key, items] of cells) {
    const [rk, cj] = key.split(":").map(Number);
    const [cw, ch] = [colW - 12, rowH - 8];
    const s = clamp(Math.sqrt((cw * ch) / items.length), 3.2, 7.5);
    const per = Math.max(1, Math.floor(cw / s));
    items.forEach(({ i, st }, k) => {
      dots[i] = { x: labW + colW * cj + 6 + (k % per) * s + s / 2, y: top + rk * rowH + 4 + Math.floor(k / per) * s + s / 2, a: 1, r: Math.min(2.8, s * 0.38), paint: st };
    });
  }
  return { dots, labels, rules: [] };
}

function diligenceView(file: IntroFile, pairs: RecordedPair[], rest: (i: number) => DotTarget, w: number, h: number): IntroView {
  const n = file.trials.id.length;
  const dots = Array.from({ length: n }, (_, i) => rest(i));
  const labels: ViewLabel[] = [];
  const list = introPairs(file, pairs);
  const cols = w > 700 ? 6 : 3, rowsN = Math.max(1, Math.ceil(list.length / cols));
  const [cw, chh] = [w / cols, h / rowsN];
  const rowIdx = new Map(file.rows.map((r, i) => [r.id, i]));
  const used = new Set<number>();
  list.forEach((p, k) => {
    const ri = rowIdx.get(p.target)!;
    const [cx, cy] = [cw * (k % cols) + cw / 2, chh * Math.floor(k / cols) + chh / 2 - 8];
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      if (used.has(i) || !file.trials.marks[i].some((m) => m[0] === ri)) continue;
      if (p.disease === "all" || file.trials.dz[i].includes(p.disease)) ids.push(i);
    }
    ids.forEach((i) => used.add(i));
    const s = clamp((Math.min(cw, chh) * 0.55) / Math.sqrt(Math.max(1, ids.length)) / 1.1, 3, 6);
    ids.forEach((i, j) => {
      const rad = s * 0.62 * Math.sqrt(j);
      dots[i] = { x: cx + Math.cos(j * GOLDEN) * rad, y: cy + Math.sin(j * GOLDEN) * rad, a: 1, r: Math.min(2.6, s * 0.4), paint: paintOf(file, i) };
    });
    labels.push({ text: `${file.rows[ri].label} · ${p.disease}`, x: cx, y: cy + Math.min(cw, chh) * 0.36 + 4, align: "center", size: 12, weight: 700 });
  });
  return { dots, labels, rules: [] };
}

function watchlistView(file: IntroFile, rest: (i: number) => DotTarget, w: number, h: number): IntroView {
  const dots = file.trials.id.map((_, i) => rest(i));
  const pad = 24, maxP = 0.6, base = h * 0.78;
  const X = (p: number) => pad + (Math.min(Math.max(p, 0), maxP) / maxP) * (w - 2 * pad);
  const risky = file.trials.risk.map((r, i) => [i, r] as const).filter((e): e is readonly [number, number] => e[1] !== null).sort((a, b) => a[1] - b[1]);
  let s = 6.2, maxStack: number, placed: { i: number; col: number; k: number }[];
  for (;;) {
    const stacks = new Map<number, number>();
    placed = risky.map(([i, p]) => {
      const col = Math.round(X(p) / s), k = stacks.get(col) ?? 0;
      stacks.set(col, k + 1);
      return { i, col, k };
    });
    maxStack = Math.max(0, ...stacks.values());
    if (s <= 2.5 || maxStack * s <= base - 40) break;
    s -= 0.4;
  }
  for (const { i, col, k } of placed) dots[i] = { x: clamp(col * s, 0, w), y: base - 6 - k * s, a: 1, r: Math.min(2.6, s * 0.42), paint: paintOf(file, i) };
  const labels: ViewLabel[] = [0, 0.2, 0.4, 0.6].map((p) => ({ text: `${Math.round(p * 100)}%${p === maxP ? "+" : ""}`, x: X(p), y: base + 20, align: "center", tone: "muted", size: 12 }));
  labels.push({ text: "estimated chance of stopping early", x: w / 2, y: base + 42, align: "center", tone: "muted", size: 12 });
  const rules: ViewRule[] = [{ kind: "axis", x: pad, y: base, length: w - 2 * pad }];
  if (file.typical !== null) {
    labels.push({ text: `typical ${Math.round(file.typical * 100)}%`, x: X(file.typical), y: Math.max(12, base - (maxStack + 2) * s - 6), align: "center", size: 12, weight: 700 });
    rules.push({ kind: "tick", x: X(file.typical), y: base, length: Math.min(150, base - 8) });
  }
  return { dots, labels, rules };
}

function approachesView(file: IntroFile, w: number, h: number): IntroView {
  const cols = file.approaches.map((a) => ({ key: a.key, label: a.label }));
  if (!cols.some((c) => c.key === "unclassified")) cols.push({ key: "unclassified", label: "Unclassified" });
  const multiAt = cols.length;
  const groups = Array.from({ length: cols.length + 1 }, () => [] as number[]);
  file.trials.approaches.forEach((aps, i) => {
    const one = aps.length === 1 ? cols.findIndex((c) => c.key === aps[0]) : -1;
    groups[aps.length > 1 ? multiAt : one >= 0 ? one : cols.findIndex((c) => c.key === "unclassified")].push(i);
  });
  const gap = 14, colW = (w - gap * cols.length) / (cols.length + 1), avail = h - 48, noteH = 20;
  const tallest = Math.max(1, ...groups.map((g) => g.length));
  let s = 8;
  while (s > 2.5 && Math.ceil(tallest / Math.max(1, Math.floor(colW / s))) * s > avail - noteH) s -= 0.25;
  const per = Math.max(1, Math.floor(colW / s));
  const dots: DotTarget[] = new Array(file.trials.id.length);
  const labels: ViewLabel[] = [{ text: APPROACH_NOTE, x: 0, y: 12, size: 12, tone: "muted" }];
  groups.forEach((g, gi) => {
    const x0 = gi * (colW + gap);
    const paint: Paint = gi === multiAt ? "multi" : `ap:${cols[gi].key}`;
    g.forEach((i, k) => {
      dots[i] = { x: x0 + (k % per) * s + s / 2, y: avail - Math.floor(k / per) * s - s / 2, a: 1, r: Math.min(2.6, s * 0.4), paint };
    });
    labels.push({ text: gi === multiAt ? MULTI_LABEL : cols[gi].label, x: x0, y: avail + 20, size: 12, weight: 700 });
    labels.push({ text: num(g.length), x: x0, y: avail + 36, size: 12, tone: "muted" });
  });
  return { dots, labels, rules: [] };
}

const BINS: { key: ChangeBin; label: string }[] = [
  { key: "dates", label: "Dates" }, { key: "status", label: "Status" }, { key: "sites", label: "Sites & countries" },
  { key: "enrollment", label: "Enrollment" }, { key: "outcomes", label: "Outcomes" }, { key: "other", label: "Other details" },
];
const SLIP = "date_slip_ge_90d";

function changesView(file: IntroFile, w: number, h: number): IntroView {
  const n = file.trials.id.length;
  const dots: DotTarget[] = new Array(n);
  const gh = h * 0.34, gy = h - gh, gs = Math.sqrt((w * gh) / Math.max(1, n)) * 0.98, gper = Math.max(1, Math.floor(w / gs));
  for (let i = 0; i < n; i++) dots[i] = { x: (i % gper) * gs + gs / 2, y: gy + Math.floor(i / gper) * gs + gs / 2, a: 0.28, r: Math.min(1.6, gs * 0.3), paint: "fin" };
  const members = BINS.map(() => [] as { i: number; reason: string | null }[]);
  file.trials.change.forEach((c, i) => {
    if (c) members[Math.max(0, BINS.findIndex((b) => b.key === c[0]))].push({ i, reason: c[1] });
  });
  const total = members.reduce((a, m) => a + m.length, 0);
  const inset = 50, cw = (w - 2 * inset) / BINS.length, cy = gy * 0.42;
  const step = clamp((cw / 2 - 6) / Math.sqrt(Math.max(1, ...members.map((m) => m.length))), 7, 15);
  const labels: ViewLabel[] = [];
  members.forEach((m, bi) => {
    m.sort((a, b) => Number(b.reason !== null) - Number(a.reason !== null));
    const cx = inset + cw * bi + cw / 2;
    m.forEach(({ i, reason }, k) => {
      const rad = step * Math.sqrt(k);
      dots[i] = { x: cx + Math.cos(k * GOLDEN) * rad, y: cy + Math.sin(k * GOLDEN) * rad, a: 1, r: reason ? 6 : 5, paint: reason ? "changed" : "changed-ring" };
    });
    const notable = m.filter((e) => e.reason !== null);
    const what = notable.length === 0 ? "" : ` · ${notable.length} ${notable.every((e) => e.reason === SLIP) ? "slipped 90+ days" : "notable"}`;
    labels.push({ text: BINS[bi].label, x: cx, y: cy + 82, align: "center", size: 13, weight: 700 });
    labels.push({ text: m.length ? `${m.length} trial${m.length > 1 ? "s" : ""}${what}` : "none this week", x: cx, y: cy + 100, align: "center", size: 12, tone: "muted" });
  });
  labels.push({ text: total ? `${total} of ${num(n)} trials changed in the last 7 days · solid = flagged as notable` : "No changes in the last 7 days", x: 0, y: gy - 12, size: 12, tone: "muted" });
  return { dots, labels, rules: [] };
}

function trialsView(file: IntroFile, w: number, h: number): IntroView {
  const n = file.trials.id.length;
  const y0 = 1995, y1 = (Number(file.generated_for.slice(0, 4)) || new Date().getFullYear()) + 1;
  const cols = y1 - y0 + 1, colW = w / cols, base = h - 40;
  const yearOf = (i: number) => clamp(file.trials.start[i] ?? y0, y0, y1);
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) counts.set(yearOf(i), (counts.get(yearOf(i)) ?? 0) + 1);
  const per = Math.max(1, Math.floor(colW / 4.2));
  const s = Math.min(colW / per, (base - 10) / Math.ceil(Math.max(1, ...counts.values()) / per));
  const rank: Record<Outcome, number> = { succeeded: 0, stopped: 1, running: 2, completed_unknown: 3, unknown: 3 };
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rank[file.trials.outcome[a]] - rank[file.trials.outcome[b]]);
  const next = new Map<number, number>();
  const dots: DotTarget[] = new Array(n);
  for (const i of order) {
    const yr = yearOf(i), c = next.get(yr) ?? 0;
    next.set(yr, c + 1);
    dots[i] = { x: (yr - y0) * colW + (c % per) * (colW / per) + colW / per / 2, y: base - Math.floor(c / per) * s - s / 2, a: 0.95, r: clamp(s * 0.42, 1.3, 2.4), paint: paintOf(file, i) };
  }
  const labels: ViewLabel[] = [];
  for (let yr = Math.ceil(y0 / 5) * 5; yr <= y1 - 1; yr += 5) labels.push({ text: String(yr), x: (yr - y0) * colW + colW / 2, y: base + 18, align: "center", tone: "muted", size: 12 });
  return { dots, labels, rules: [{ kind: "axis", x: 0, y: base, length: w }] };
}

export function buildViews(file: IntroFile, pairs: RecordedPair[], w: number, h: number): Record<ViewKey, IntroView> {
  const cloud = cloudPositions(file, w, h);
  const rest = (i: number): DotTarget => ({ ...cloud[i], a: 0.035, r: 1.4, paint: "ghost" });
  const views: Record<ViewKey, IntroView> = {
    all: { dots: cloud.map((p, i) => ({ ...p, a: 0.95, r: file.trials.outcome[i] === "succeeded" ? 2.9 : 2.2, paint: paintOf(file, i) })), labels: [], rules: [] },
    pipeline: pipelineView(file, rest, w, h),
    diligence: diligenceView(file, pairs, rest, w, h),
    watchlist: watchlistView(file, rest, w, h),
    approaches: approachesView(file, w, h),
    changes: changesView(file, w, h),
    trials: trialsView(file, w, h),
  };
  for (const k of VIEW_ORDER) for (const d of views[k].dots) { d.x = clamp(d.x, 0, w); d.y = clamp(d.y, 0, h); }
  return views;
}

/** The views worth showing: diligence needs a pair that still names a row, watchlist needs at least one risk value. */
export function visibleViews(file: IntroFile, pairs: RecordedPair[]): ViewKey[] {
  const hasRisk = file.trials.risk.some((r) => r !== null);
  const hasPairs = introPairs(file, pairs).length > 0;
  return VIEW_ORDER.filter((k) => (k !== "diligence" || hasPairs) && (k !== "watchlist" || hasRisk));
}
