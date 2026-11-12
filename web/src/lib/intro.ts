import type { ChangeBin, IntroFile, Outcome, RowState } from "../types";
import type { RecordedPair } from "./diligenceRelease";

export type ViewKey = "all" | "pipeline" | "diligence" | "watchlist" | "approaches" | "changes" | "trials";
export type Paint = RowState | "ghost" | "changed" | "changed-ring" | "multi" | `ap:${string}`;
export interface DotTarget { x: number; y: number; a: number; r: number; paint: Paint }
/** maxW: the label wraps within this width (up to maxLines, default 2) before it is truncated; y is the first baseline. */
export interface ViewLabel { text: string; x: number; y: number; align?: CanvasTextAlign; weight?: 400 | 700; size?: number; tone?: "ink" | "muted"; maxW?: number; maxLines?: number }
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
export const APPROACH_NOTE = "Trials in several approaches are under More than one; the Approaches page counts them in each.";
const GOLDEN = 2.39996;
/** Smallest dot spacing a cell, bin or cluster shrinks to before it shows "+N" instead of more dots. */
const MIN_STEP = 1.6;
/** Canvas widths below this get the compact layouts (phone). */
const NARROW = 500;
const LH = 1.25;
/** The caption's colour word for "moved on" follows the painted theme (red in light, orange in dark). */
export function captionText(view: ViewKey, theme: "light" | "dark"): string {
  return VIEW_TEXT[view].caption.replace(/\bRed ones\b/, theme === "dark" ? "Orange ones" : "Red ones");
}
/** Lines a label of this text will wrap to in maxW (a rough 0.5 em per character estimate; the canvas measures for real). */
const estLines = (text: string, maxW: number, size: number, max = 2) => Math.max(1, Math.min(max, Math.ceil((text.length * size * 0.5) / Math.max(1, maxW))));
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
    const [cw, ch] = [Math.max(1, colW - 12), Math.max(1, rowH - 8)];
    let s = clamp(Math.sqrt((cw * ch) / items.length), MIN_STEP, 7.5);
    while (s > MIN_STEP && Math.floor(cw / s) * Math.floor(ch / s) < items.length) s = Math.max(MIN_STEP, s - 0.2);
    const per = Math.max(1, Math.floor(cw / s));
    const cap = per * Math.max(1, Math.floor(ch / s));
    if (items.length > cap) labels.push({ text: `+${items.length - cap}`, x: labW + colW * (cj + 1) - 6, y: top + (rk + 1) * rowH - 4, align: "right", size: 12, tone: "muted" });
    items.slice(0, cap).forEach(({ i, st }, k) => {
      dots[i] = { x: labW + colW * cj + 6 + (k % per) * s + s / 2, y: top + rk * rowH + 4 + Math.floor(k / per) * s + s / 2, a: 1, r: Math.min(2.8, s * 0.38), paint: st };
    });
  }
  return { dots, labels, rules: [] };
}

function diligenceView(file: IntroFile, pairs: RecordedPair[], rest: (i: number) => DotTarget, w: number, h: number): IntroView {
  const n = file.trials.id.length;
  const dots = Array.from({ length: n }, (_, i) => rest(i));
  const labels: ViewLabel[] = [];
  const all = introPairs(file, pairs);
  // A target with an "all" memo is one cluster with every trial on its row; its per-disease memos are not separate clusters.
  const wholeRow = new Set(all.filter((p) => p.disease === "all").map((p) => p.target));
  const list = all.filter((p) => p.disease === "all" || !wholeRow.has(p.target));
  const cols = w >= 600 ? 6 : 3, rowsN = Math.max(1, Math.ceil(list.length / cols));
  const cw = w / cols;
  const rowIdx = new Map(file.rows.map((r, i) => [r.id, i]));
  const lh = 12 * LH, maxW = cw - 8;
  const text = (p: RecordedPair) => `${file.rows[rowIdx.get(p.target)!].label} · ${p.disease}`;
  const used = new Set<number>();
  const members = list.map((p) => {
    const ri = rowIdx.get(p.target)!;
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      if (used.has(i) || !file.trials.marks[i].some((m) => m[0] === ri)) continue;
      if (p.disease === "all" || file.trials.dz[i].includes(p.disease)) ids.push(i);
    }
    ids.forEach((i) => used.add(i));
    return ids;
  });
  const rowOf = (k: number) => Math.floor(k / cols);
  // Text lines a row reserves under its clusters: the name (wrapped), and "+N more" only where a cluster is cut.
  const nameLines = Array.from({ length: rowsN }, (_, r) => Math.max(1, ...list.map((p, k) => (rowOf(k) === r ? estLines(text(p), maxW, 12) : 1))));
  const more = Array.from({ length: rowsN }, () => 0);
  const capFor = (len: number, rad: number) => Math.floor((rad / clamp(rad / Math.sqrt(Math.max(1, len)), 1.2, 3.72)) ** 2) + 1;
  const textOf = (r: number) => (nameLines[r] + more[r]) * lh + 14;
  let maxRad = 0;
  for (let pass = 0; pass < 4; pass++) {
    const textSum = nameLines.reduce((a, _, r) => a + textOf(r), 0);
    maxRad = Math.max(0, Math.min(cw / 2 - 6, (h - textSum) / (2 * rowsN) - 3));
    let changed = false;
    members.forEach((ids, k) => { if (more[rowOf(k)] === 0 && ids.length > capFor(ids.length, maxRad)) { more[rowOf(k)] = 1; changed = true; } });
    if (!changed) break;
  }
  // Too little height for a cluster above its label (phone): clusters sit beside their labels in two columns instead.
  if (maxRad < 14 && list.length > 0) {
    const sCols = 2, sRows = Math.ceil(list.length / sCols), sw = w / sCols, rowH = h / sRows;
    const rad = clamp(rowH / 2 - 2, 3, 14);
    list.forEach((p, k) => {
      const ids = members[k];
      const [x0, cy] = [sw * (k % sCols), rowH * Math.floor(k / sCols) + rowH / 2];
      const cx = x0 + rad + 2, tx = x0 + 2 * rad + 10, tw = sw - 2 * rad - 14;
      const d = clamp(rad / Math.sqrt(Math.max(1, ids.length)), 1.2, 3.72);
      const cap = capFor(ids.length, rad);
      ids.slice(0, cap).forEach((i, j) => {
        const r = d * Math.sqrt(j);
        dots[i] = { x: cx + Math.cos(j * GOLDEN) * r, y: cy + Math.sin(j * GOLDEN) * r, a: 1, r: Math.min(2.6, d * 0.65), paint: paintOf(file, i) };
      });
      const lines = estLines(text(p), tw, 12);
      const y = cy + 4 - ((lines - 1) * lh) / 2 - (ids.length > cap ? lh / 2 : 0);
      labels.push({ text: text(p), x: tx, y, size: 12, weight: 700, maxW: tw });
      if (ids.length > cap) labels.push({ text: `+${ids.length - cap} more`, x: tx, y: y + lines * lh, size: 12, tone: "muted", maxW: tw, maxLines: 1 });
    });
    return { dots, labels, rules: [] };
  }
  const blocks = nameLines.map((_, r) => 2 * maxRad + 6 + textOf(r));
  const gapY = Math.max(0, (h - blocks.reduce((a, b) => a + b, 0)) / rowsN);
  const rowTop = blocks.map((_, r) => blocks.slice(0, r).reduce((a, b) => a + b, 0) + gapY * (r + 0.5));
  list.forEach((p, k) => {
    const ids = members[k], r = rowOf(k);
    const d = clamp(maxRad / Math.sqrt(Math.max(1, ids.length)), 1.2, 3.72);
    const cap = capFor(ids.length, maxRad);
    const cx = cw * (k % cols) + cw / 2, cy = rowTop[r] + maxRad + 3;
    ids.slice(0, cap).forEach((i, j) => {
      const rad = d * Math.sqrt(j);
      dots[i] = { x: cx + Math.cos(j * GOLDEN) * rad, y: cy + Math.sin(j * GOLDEN) * rad, a: 1, r: Math.min(2.6, d * 0.65), paint: paintOf(file, i) };
    });
    const nameY = cy + maxRad + 14;
    labels.push({ text: text(p), x: cx, y: nameY, align: "center", size: 12, weight: 700, maxW });
    if (ids.length > cap) labels.push({ text: `+${ids.length - cap} more`, x: cx, y: nameY + nameLines[r] * lh, align: "center", size: 12, tone: "muted", maxW, maxLines: 1 });
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
    const ly = Math.max(12, base - (maxStack + 2) * s - 6);
    labels.push({ text: `typical ${Math.round(file.typical * 100)}%`, x: X(file.typical), y: ly, align: "center", size: 12, weight: 700 });
    rules.push({ kind: "tick", x: X(file.typical), y: base, length: Math.max(8, base - ly - 5) });
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
  // Narrow canvases keep only the counts under the columns; the key under the canvas names every approach in the same order and colours.
  const narrow = w < NARROW, gap = narrow ? 6 : 12, nameLh = 12 * LH;
  const colW = (w - gap * cols.length) / (cols.length + 1);
  // Names go under the columns only when the longest word fits the column (about 6.6px a bold character at 12px); otherwise the key names them.
  const longest = Math.max(...[...cols.map((c) => c.label), MULTI_LABEL].flatMap((t) => t.split(" ")).map((t) => t.length));
  const names = !narrow && longest * 6.6 <= colW + gap - 4;
  const block = names ? 24 + 2 * nameLh + 8 : 24;
  const base = h - block, availH = Math.max(1, base - 6);
  const tallest = Math.max(1, ...groups.map((g) => g.length));
  let s = 8;
  while (s > MIN_STEP && Math.ceil(tallest / Math.max(1, Math.floor(colW / s))) * s > availH) s = Math.max(MIN_STEP, s - 0.2);
  // Still too tall at the smallest step: widen the columns' rows (closer horizontal pitch) instead of running off the top.
  const per = Math.max(1, Math.floor(colW / s), Math.ceil(tallest / Math.max(1, Math.floor(availH / s))));
  const sx = colW / per;
  const dots: DotTarget[] = new Array(file.trials.id.length);
  const labels: ViewLabel[] = [];
  groups.forEach((g, gi) => {
    const x0 = gi * (colW + gap);
    const paint: Paint = gi === multiAt ? "multi" : `ap:${cols[gi].key}`;
    g.forEach((i, k) => {
      dots[i] = { x: x0 + (k % per) * sx + sx / 2, y: base - Math.floor(k / per) * s - s / 2, a: 1, r: Math.min(2.6, Math.min(sx, s) * 0.4), paint };
    });
    labels.push({ text: num(g.length), x: x0, y: base + 16, size: 12, tone: "muted" });
    if (names) labels.push({ text: gi === multiAt ? MULTI_LABEL : cols[gi].label, x: x0, y: base + 16 + nameLh + 4, size: 12, weight: 700, maxW: colW + gap - 4 });
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
  const narrow = w < NARROW;
  const gh = h * 0.2, gy = h - gh, gs = Math.sqrt((w * gh) / Math.max(1, n)) * 0.98, gper = Math.max(1, Math.floor(w / gs));
  for (let i = 0; i < n; i++) dots[i] = { x: (i % gper) * gs + gs / 2, y: gy + Math.floor(i / gper) * gs + gs / 2, a: 0.28, r: Math.min(1.6, gs * 0.3), paint: "fin" };
  const members = BINS.map(() => [] as { i: number; reason: string | null }[]);
  file.trials.change.forEach((c, i) => {
    if (c) members[Math.max(0, BINS.findIndex((b) => b.key === c[0]))].push({ i, reason: c[1] });
  });
  const total = members.reduce((a, m) => a + m.length, 0);
  // Six bins in a row need about 120px each for their longest line ("6 slipped 90+ days"); below that, three by two.
  const compact = narrow || w < 820;
  const [cols, rowsN, inset] = compact ? [3, 2, 0] : [6, 1, 50];
  const cw = (w - 2 * inset) / cols;
  const [rN, rR] = narrow ? [5, 4] : [6, 5];
  const nameSize = narrow ? 12 : 13, lh = nameSize * LH, maxW = cw - 8;
  const nameLines = Math.max(1, ...BINS.map((b) => estLines(b.label, maxW, nameSize)));
  const capOf = (len: number, maxRad: number) => Math.floor((maxRad / clamp(maxRad / Math.sqrt(Math.max(1, len)), MIN_STEP, 15)) ** 2) + 1;
  /** Bubble radius that fits the cell once the summary line (if any) and the text lines are paid for. */
  const plan = (summary: boolean, more: boolean) => {
    const top = gy - (summary ? 30 : 4);
    const cellH = top / rowsN, textH = (nameLines + 2 + (more ? 1 : 0)) * lh + 10;
    return { summary, more, cellH, textH, maxRad: Math.max(0, Math.min(cw / 2 - rN - 2, 70, (cellH - textH) / 2 - rN - 2)) };
  };
  let pl = plan(true, false);
  if (pl.maxRad < 12) pl = plan(false, false);
  if (members.some((m) => m.length > capOf(m.length, pl.maxRad))) pl = plan(pl.summary, true);
  const { maxRad, textH, cellH } = pl;
  const labels: ViewLabel[] = [];
  members.forEach((m, bi) => {
    m.sort((a, b) => Number(b.reason !== null) - Number(a.reason !== null));
    const [col, row] = [bi % cols, Math.floor(bi / cols)];
    const cx = inset + cw * col + cw / 2;
    const cy = row * cellH + (cellH - (2 * (maxRad + rN) + textH)) / 2 + maxRad + rN;
    const step = clamp(maxRad / Math.sqrt(Math.max(1, m.length)), MIN_STEP, 15);
    const cap = Math.floor((maxRad / step) ** 2) + 1;
    m.slice(0, cap).forEach(({ i, reason }, k) => {
      const rad = step * Math.sqrt(k);
      dots[i] = { x: cx + Math.cos(k * GOLDEN) * rad, y: cy + Math.sin(k * GOLDEN) * rad, a: 1, r: reason ? rN : rR, paint: reason ? "changed" : "changed-ring" };
    });
    const notable = m.filter((e) => e.reason !== null);
    const nameY = cy + maxRad + rN + 10 + nameSize * 0.9;
    labels.push({ text: BINS[bi].label, x: cx, y: nameY, align: "center", size: nameSize, weight: 700, maxW });
    let y = nameY + nameLines * lh;
    const line = (text: string) => { labels.push({ text, x: cx, y, align: "center", size: 12, tone: "muted", maxW, maxLines: 1 }); y += lh; };
    line(m.length ? `${m.length} trial${m.length > 1 ? "s" : ""}` : "none this week");
    if (notable.length) line(`${notable.length} ${notable.every((e) => e.reason === SLIP) ? "slipped 90+ days" : "notable"}`);
    if (m.length > cap) line(`+${m.length - cap} more`);
  });
  if (pl.summary) {
    const full = `${total} of ${num(n)} trials changed in the last 7 days · solid = flagged as notable`;
    const text = total ? (narrow ? `${total} of ${num(n)} trials changed in the last 7 days` : full) : "No changes in the last 7 days";
    labels.push({ text, x: 0, y: gy - 10, size: 12, tone: "muted", maxW: w, maxLines: 1 });
  }
  return { dots, labels, rules: [] };
}

function trialsView(file: IntroFile, w: number, h: number): IntroView {
  const n = file.trials.id.length;
  const y0 = 1995, y1 = (Number(file.generated_for.slice(0, 4)) || new Date().getFullYear()) + 1;
  // Narrow canvases use two-year columns; years before 1995 fold into the first column, labelled "≤1995".
  const span = w < NARROW ? 2 : 1;
  const cols = Math.ceil((y1 - y0 + 1) / span), colW = w / cols, base = h - 40;
  const yearOf = (i: number) => clamp(file.trials.start[i] ?? y0, y0, y1);
  const colOf = (yr: number) => Math.floor((yr - y0) / span);
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) counts.set(colOf(yearOf(i)), (counts.get(colOf(yearOf(i))) ?? 0) + 1);
  // Dots per row so that the horizontal pitch and the vertical step come out about equal (no streaks).
  const tallest = Math.max(1, ...counts.values());
  const per = clamp(Math.round(Math.sqrt((colW * tallest) / Math.max(1, base - 10))), 1, Math.max(1, Math.floor(colW / 2.2)));
  const s = Math.min(colW / per, (base - 10) / Math.ceil(tallest / per));
  const rank: Record<Outcome, number> = { succeeded: 0, stopped: 1, running: 2, completed_unknown: 3, unknown: 3 };
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rank[file.trials.outcome[a]] - rank[file.trials.outcome[b]]);
  const next = new Map<number, number>();
  const dots: DotTarget[] = new Array(n);
  for (const i of order) {
    const cj = colOf(yearOf(i)), c = next.get(cj) ?? 0;
    next.set(cj, c + 1);
    dots[i] = { x: cj * colW + (c % per) * (colW / per) + colW / per / 2, y: base - Math.floor(c / per) * s - s / 2, a: 0.95, r: clamp(Math.min(s, colW / per) * 0.42, 1.3, 2.4), paint: paintOf(file, i) };
  }
  const labels: ViewLabel[] = [{ text: `≤${y0}`, x: 0, y: base + 18, tone: "muted", size: 12 }];
  for (let yr = Math.ceil((y0 + (span === 2 ? 10 : 1)) / (span * 5)) * span * 5; yr <= y1 - 1; yr += span * 5) labels.push({ text: String(yr), x: colOf(yr) * colW + colW / 2, y: base + 18, align: "center", tone: "muted", size: 12 });
  return { dots, labels, rules: [{ kind: "axis", x: 0, y: base, length: w }] };
}

/** The layouts before the final clamp to the canvas; tests use it to see whether anything actually lands off-canvas. */
export function buildViewsRaw(file: IntroFile, pairs: RecordedPair[], w: number, h: number): Record<ViewKey, IntroView> {
  if (!(w >= 1 && h >= 1)) {
    const flat = (): IntroView => ({ dots: file.trials.id.map(() => ({ x: 0, y: 0, a: 0.035, r: 1.4, paint: "ghost" as const })), labels: [], rules: [] });
    return { all: flat(), pipeline: flat(), diligence: flat(), watchlist: flat(), approaches: flat(), changes: flat(), trials: flat() };
  }
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
  return views;
}

export function buildViews(file: IntroFile, pairs: RecordedPair[], w: number, h: number): Record<ViewKey, IntroView> {
  const views = buildViewsRaw(file, pairs, w, h);
  for (const k of VIEW_ORDER) for (const d of views[k].dots) { d.x = clamp(d.x, 0, w); d.y = clamp(d.y, 0, h); }
  return views;
}

/** The views worth showing: diligence needs a pair that still names a row, watchlist needs at least one risk value. */
export function visibleViews(file: IntroFile, pairs: RecordedPair[]): ViewKey[] {
  const hasRisk = file.trials.risk.some((r) => r !== null);
  const hasPairs = introPairs(file, pairs).length > 0;
  return VIEW_ORDER.filter((k) => (k !== "diligence" || hasPairs) && (k !== "watchlist" || hasRisk));
}
