import type { ExplorerFile, ExplorerStats, ExplorerTrial, Outcome } from "../types";
import { phaseLabel, treatmentLabel } from "./format";

export type ColorMode = "outcome" | "phase" | "disease";

export interface Filters {
  conditions: Set<string>;
  phases: Set<string>;
  outcomes: Set<Outcome>;
  treatmentTypes: Set<string>;
  query: string;
  /** On: only trials with results posted. Off (default): every trial, results or not. */
  resultsOnly: boolean;
  /** Inclusive start-year range. */
  years: [number, number];
}

export type SetKey = "conditions" | "phases" | "outcomes" | "treatmentTypes";

export interface Palette {
  succeeded: string;
  stopped: string;
  completed_unknown: string;
  running: string;
  /** Fallback fill for a missing phase or condition. */
  unknown: string;
  /** Outcome "unknown": drawn as a hollow ring, so shape (not shade) sets it apart. */
  unknownRing: string;
  phases: Record<string, string>;
  /**
   * Disease mode: one hue per condition, by its place in the area's order (see diseaseSeries), cycling.
   * No ink, no red: red is reserved for succeeded.
   */
  diseases: string[];
}

export const LIGHT_PALETTE: Palette = {
  succeeded: "#c8102e",
  stopped: "#222222",
  completed_unknown: "#c9d1d8",
  running: "#3c5488",
  unknown: "#e4e8eb",
  unknownRing: "#8796a3",
  phases: {
    EARLY_PHASE1: "#e4e8eb",
    PHASE1: "#c9d1d7",
    PHASE2: "#8796a3",
    PHASE3: "#3b4a57",
    PHASE4: "#111111",
    NA: "#e4e8eb",
  },
  // Editorial journal: one hue per condition, in the area's condition order.
  diseases: ["#3c5488", "#00a087", "#8e5ea2", "#4dbbd5", "#e0a030", "#7e6148"],
};

export const DARK_PALETTE: Palette = {
  succeeded: "#ff8a3d",
  stopped: "#eceae4",
  completed_unknown: "#50575f",
  running: "#8da3d6",
  unknown: "#2b2e33",
  unknownRing: "#6c7f93",
  phases: {
    EARLY_PHASE1: "#2b2e33",
    PHASE1: "#3d4147",
    PHASE2: "#6c7f93",
    PHASE3: "#7fb2e5",
    PHASE4: "#eceae4",
    NA: "#2b2e33",
  },
  diseases: ["#8da3d6", "#3cc7a8", "#cf8fd6", "#7fd3e6", "#f0c060", "#b8977a"],
};

export const OUTCOMES: Outcome[] = ["succeeded", "stopped", "completed_unknown", "running", "unknown"];

/** Phase buckets in reading order; anything else sorts after these. */
export const PHASES = ["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"];

/** A trial's phase bucket for filtering; a missing phase counts as "NA". */
export const phaseKey = (t: ExplorerTrial): string => t.phase ?? "NA";

/**
 * Disease colour for a condition label, by its place in ``series`` (see diseaseSeries): each condition
 * keeps its own hue whatever its share, cycling past the end of the palette's series.
 */
export function diseaseColor(label: string | undefined, palette: Palette, series: string[]): string {
  const i = label === undefined ? -1 : series.indexOf(label);
  return i < 0 ? palette.unknown : palette.diseases[i % palette.diseases.length];
}

/** Conditions some trial lists first: the only ones disease colouring can paint. */
export function firstLabels(trials: ExplorerTrial[]): Set<string> {
  const out = new Set<string>();
  for (const t of trials) if (t.condition_labels.length > 0) out.add(t.condition_labels[0]);
  return out;
}

/**
 * The order disease colours are dealt in: the area's conditions as configured, then any other condition
 * some trial lists first, alphabetically. Share plays no part, so a condition's hue is the same in every
 * build and never shifts when filtering.
 */
export function diseaseSeries(trials: ExplorerTrial[], conditionOrder: string[]): string[] {
  const extra = [...firstLabels(trials)].filter((c) => !conditionOrder.includes(c)).sort((a, b) => a.localeCompare(b));
  return [...conditionOrder, ...extra];
}

/**
 * The area's conditions in descending share of trials that list them first (disease colours go by a
 * trial's first label); ties, and conditions no trial lists first, keep the area's order. Computed over
 * every trial so colours never shift when filtering.
 */
export function diseaseRanking(trials: ExplorerTrial[], conditionOrder: string[]): string[] {
  const n = tally(trials, (t) => (t.condition_labels.length > 0 ? [t.condition_labels[0]] : []));
  const all = [...new Set([...conditionOrder, ...n.keys()])];
  const rank = (c: string) => (conditionOrder.includes(c) ? conditionOrder.indexOf(c) : conditionOrder.length);
  return all.sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || rank(a) - rank(b) || a.localeCompare(b));
}

/** Filters with one set replaced by ``all``. */
export function setAll(f: Filters, key: SetKey, all: Iterable<string>): Filters {
  return { ...f, [key]: new Set(all) };
}

/** Filters with one set emptied. */
export const setNone = (f: Filters, key: SetKey): Filters => setAll(f, key, []);

/** Dropdown summary: "all", "none" or "2 of 6". */
export const filterSummary = (selected: number, total: number): string =>
  selected >= total ? "all" : selected === 0 ? "none" : `${selected} of ${total}`;

/** How many trials carry each key; a trial adds one to every key ``keys`` returns for it. */
export function tally(trials: ExplorerTrial[], keys: (t: ExplorerTrial) => string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trials) for (const k of keys(t)) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/** Counts per value of each filter, over every trial given. */
export function filterCounts(trials: ExplorerTrial[]) {
  return {
    conditions: tally(trials, (t) => t.condition_labels),
    phases: tally(trials, (t) => [phaseKey(t)]),
    outcomes: tally(trials, (t) => [t.outcome]),
    treatmentTypes: tally(trials, (t) => t.treatment_types),
  };
}

/** Phase keys present in ``counts``, in reading order (unknown keys after, alphabetically). */
export function phasesOf(counts: Map<string, number>): string[] {
  const rank = (k: string) => (PHASES.includes(k) ? PHASES.indexOf(k) : PHASES.length);
  return [...counts.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** The colour modes, with their names as shown. */
export const MODES: [ColorMode, string][] = [
  ["outcome", "Outcome"],
  ["phase", "Phase"],
  ["disease", "Disease"],
];

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** True when two filter states select the same trials by the same rules (sets compared by members). */
export function sameFilters(a: Filters, b: Filters): boolean {
  return (
    sameSet(a.conditions, b.conditions) &&
    sameSet(a.phases, b.phases) &&
    sameSet(a.outcomes, b.outcomes) &&
    sameSet(a.treatmentTypes, b.treatmentTypes) &&
    a.query === b.query &&
    a.resultsOnly === b.resultsOnly &&
    a.years[0] === b.years[0] &&
    a.years[1] === b.years[1]
  );
}

/** Earliest and latest start year among trials that have one; [0, 0] when none do. */
export function yearBounds(trials: ExplorerTrial[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of trials) {
    if (t.start_year === null) continue;
    lo = Math.min(lo, t.start_year);
    hi = Math.max(hi, t.start_year);
  }
  return lo > hi ? [0, 0] : [lo, hi];
}

/** True when the year range spans the whole of ``bounds``. */
export const isFullYears = (f: Filters, bounds: [number, number]): boolean =>
  f.years[0] <= bounds[0] && f.years[1] >= bounds[1];

/** Filters with every value present in the file switched on. */
export const allFilters = (f: ExplorerFile): Filters =>
  filtersFor(f.trials, f.stats.by_condition.map((c) => c.label));

/** Filters with every value among ``trials`` switched on, plus the ``conditions`` named (labels with no trials). */
export function filtersFor(trials: ExplorerTrial[], conditionLabels: Iterable<string>): Filters {
  const conditions = new Set<string>(conditionLabels);
  const phases = new Set<string>();
  const treatmentTypes = new Set<string>();
  for (const t of trials) {
    t.condition_labels.forEach((l) => conditions.add(l));
    phases.add(phaseKey(t));
    t.treatment_types.forEach((x) => treatmentTypes.add(x));
  }
  return {
    conditions,
    phases,
    outcomes: new Set(OUTCOMES),
    treatmentTypes,
    query: "",
    resultsOnly: false,
    years: yearBounds(trials),
  };
}

/**
 * A trial with no labels or no types cannot be filtered out by those sets. A trial with no start year
 * passes the year filter only while the range spans all of ``bounds``.
 */
export function matches(t: ExplorerTrial, f: Filters, bounds: [number, number]): boolean {
  if (t.start_year === null ? !isFullYears(f, bounds) : t.start_year < f.years[0] || t.start_year > f.years[1])
    return false;
  if (t.condition_labels.length > 0 && !t.condition_labels.some((l) => f.conditions.has(l))) return false;
  if (!f.phases.has(phaseKey(t))) return false;
  if (!f.outcomes.has(t.outcome)) return false;
  if (f.resultsOnly && !t.has_results) return false;
  if (t.treatment_types.length > 0 && !t.treatment_types.some((x) => f.treatmentTypes.has(x))) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = [t.nct_id, t.title, ...t.drugs, t.lead_sponsor ?? ""];
    if (!hay.some((h) => h.toLowerCase().includes(q))) return false;
  }
  return true;
}

/** The colour an outcome is drawn in; "unknown" is a ring, so it gets the ring's mid grey. */
export const outcomeColor = (o: Outcome, palette: Palette): string =>
  o === "unknown" ? palette.unknownRing : palette[o];

/**
 * Which visible trials the canvas redraws on top (opaque, at least 3px, knockout ring): succeeded trials
 * in outcome mode; in disease mode every trial whose first condition is not the dominant one, so small
 * conditions are not buried under the large one; none in phase mode.
 */
export function emphasisFor(mode: ColorMode, ranked: string[]): ((t: ExplorerTrial) => boolean) | undefined {
  if (mode === "outcome") return (t) => t.outcome === "succeeded";
  if (mode === "disease") return (t) => t.condition_labels.length > 0 && t.condition_labels[0] !== ranked[0];
  return undefined;
}

/** ``series`` is the disease colour order (diseaseSeries), used in disease mode only. */
export function colorFor(t: ExplorerTrial, mode: ColorMode, palette: Palette, series: string[]): string {
  if (mode === "outcome") return outcomeColor(t.outcome, palette);
  if (mode === "phase") return (t.phase && palette.phases[t.phase]) || palette.unknown;
  return diseaseColor(t.condition_labels[0], palette, series);
}

export interface Projected {
  sx: number;
  sy: number;
  depth: number;
  f: number;
}

const CAMERA = 3;

/** Rotate about the vertical axis by angle, about the horizontal axis by tilt, then perspective-project. */
export function project(
  points: { x: number; y: number; z: number }[],
  angle: number,
  tilt: number,
  w: number,
  h: number,
  zoom: number,
): Projected[] {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const scale = (Math.min(w, h) / 2) * zoom;
  return points.map((p) => {
    const x1 = p.x * ca + p.z * sa;
    const z1 = -p.x * sa + p.z * ca;
    const y2 = p.y * ct - z1 * st;
    const z2 = p.y * st + z1 * ct;
    const f = CAMERA / (CAMERA - z2);
    return { sx: w / 2 + x1 * scale * f, sy: h / 2 + y2 * scale * f, depth: z2, f };
  });
}

/**
 * The map's zoom and pan, applied on screen after projection: a point projected at (sx, sy) at 1x is
 * drawn at (k * sx + x, k * sy + y). Only positions scale; dots, rings and labels keep their size.
 */
export interface View {
  k: number;
  x: number;
  y: number;
}

export const IDENTITY_VIEW: View = { k: 1, x: 0, y: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * ``view`` with its pan clamped so the 1x frame still covers the whole w x h canvas: the cloud can be
 * panned to its edge, never out of sight. At 1x that is exactly the identity.
 */
export function clampView(view: View, w: number, h: number): View {
  const k = clampNum(view.k, MIN_ZOOM, MAX_ZOOM);
  if (k === 1) return IDENTITY_VIEW;
  return { k, x: clampNum(view.x, w - k * w, 0), y: clampNum(view.y, h - k * h, 0) };
}

/** Zoom by ``factor`` about the screen point (px, py), which stays under the pointer; 1x to 8x. */
export function zoomAt(view: View, factor: number, px: number, py: number, w: number, h: number): View {
  const k = clampNum(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const f = k / view.k;
  return clampView({ k, x: px - f * (px - view.x), y: py - f * (py - view.y) }, w, h);
}

/** Pan by (dx, dy) screen px, clamped (see clampView). */
export const panBy = (view: View, dx: number, dy: number, w: number, h: number): View =>
  clampView({ k: view.k, x: view.x + dx, y: view.y + dy }, w, h);

/** Projected points as drawn under ``view``; the same array at 1x. */
export function viewPoints(projected: Projected[], view: View): Projected[] {
  if (view.k === 1 && view.x === 0 && view.y === 0) return projected;
  return projected.map((p) => ({ ...p, sx: view.k * p.sx + view.x, sy: view.k * p.sy + view.y }));
}

/** Index of the projected point nearest (x, y) within maxPx, or -1. Points with mask[i] === 0 are skipped. */
export function nearestIndex(
  projected: Projected[],
  x: number,
  y: number,
  maxPx = 12,
  mask?: ArrayLike<number>,
): number {
  let best = -1;
  let bestD = maxPx * maxPx;
  for (let i = 0; i < projected.length; i++) {
    if (mask && !mask[i]) continue;
    const p = projected[i];
    const d = (p.sx - x) ** 2 + (p.sy - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const two = (n: number): string => n.toFixed(2);

/** A p-value to two significant digits, floored at "< 0.001". */
export function formatP(p: number): string {
  return p < 0.001 ? "< 0.001" : String(Number(p.toPrecision(2)));
}

export type SuccessBy = "disease" | "modality" | "mechanism";
export interface SuccessGroup {
  group: string;
  finished: number;
  succeeded: number;
  rate: number | null;
}

/**
 * Panel b grouping: finished trials that could succeed (the pool), counted in every group they touch.
 * Disease groups use succeeded_in (per-condition success); the others use the trial's own outcome.
 * `rate` is null below minGroup. Sorted by finished desc; with `order` (disease view) the area order is kept
 * and every listed group appears, even with none finished.
 */
export function successGroups(
  trials: ExplorerTrial[],
  by: SuccessBy,
  minGroup: number,
  topN = 8,
  order?: string[],
): SuccessGroup[] {
  const acc = new Map<string, { finished: number; succeeded: number }>();
  for (const g of order ?? []) acc.set(g, { finished: 0, succeeded: 0 });
  for (const t of trials) {
    if (!t.in_pool) continue;
    const groups = by === "disease" ? t.condition_labels : by === "modality" ? t.modalities : t.mechanisms;
    for (const g of new Set(groups)) {
      const row = acc.get(g) ?? { finished: 0, succeeded: 0 };
      row.finished += 1;
      if (by === "disease" ? t.succeeded_in.includes(g) : t.outcome === "succeeded") row.succeeded += 1;
      acc.set(g, row);
    }
  }
  const rows = [...acc].map(([group, r]) => ({
    group,
    ...r,
    rate: r.finished >= minGroup && r.finished > 0 ? r.succeeded / r.finished : null,
  }));
  if (order) return rows;
  return rows.sort((a, b) => b.finished - a.finished || a.group.localeCompare(b.group)).slice(0, topN);
}

/** "p = 0.058" or "p < 0.001", with non-breaking spaces so the clause never wraps. */
const pClause = (p: number): string => {
  const f = formatP(p);
  return (f.startsWith("<") ? `p ${f}` : `p = ${f}`).replace(/ /g, "\u00a0");
};

export function liftSentence(s: ExplorerStats): string {
  if (s.verdict === "insufficient") return "Too few successes in this area to measure clustering yet.";
  if (s.verdict === "chance") {
    const p = s.p_value === null ? "" : ` (${pClause(s.p_value)})`;
    return `Trials that succeeded cluster no more than chance would${p}.`;
  }
  const [lo, hi] = s.baseline_range ?? [NaN, NaN];
  const p = s.p_value === null ? "" : `; ${pClause(s.p_value)}`;
  return (
    `Trials that succeeded have neighbours that succeed ${two(s.lift ?? NaN)}× as often as the average ` +
    `finished trial (shuffled labels: ${two(lo)}–${two(hi)}×${p}).`
  );
}

export interface ClusterAnchor {
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface ClusterOptions {
  /** Fewest first-label trials a condition needs for a label. */
  min?: number;
  /** Most labels returned. */
  max?: number;
  /** Neighbourhood radius in fitted (unit-cloud) coordinates. */
  radius?: number;
  /** A condition holding more than this share of all trials is the background: no label. */
  maxShare?: number;
  /** Fewer than this share of the condition's trials near its densest point: no real cluster, no label. */
  minDensity?: number;
}

/**
 * One anchor per condition in the configured order, at its densest point: among the trials whose FIRST
 * condition label is that condition, the one with the most same-condition trials within ``radius``.
 * A condition gets no anchor when it has fewer than ``min`` trials, holds more than ``maxShare`` of all
 * trials, or has fewer than ``minDensity`` of its trials within ``radius`` of that point. At most
 * ``max`` anchors. ``points`` are the trials' fitted positions, index-aligned. Run once, not per frame.
 */
export function clusterAnchors(
  trials: ExplorerTrial[],
  points: { x: number; y: number; z: number }[],
  conditionOrder: string[],
  { min = 5, max = 6, radius = 0.12, maxShare = 0.6, minDensity = 0.25 }: ClusterOptions = {},
): ClusterAnchor[] {
  const groups = new Map<string, number[]>();
  trials.forEach((t, i) => {
    const label = t.condition_labels[0];
    if (label === undefined) return;
    const g = groups.get(label) ?? [];
    g.push(i);
    groups.set(label, g);
  });
  const r2 = radius * radius;
  const out: ClusterAnchor[] = [];
  for (const label of conditionOrder) {
    if (out.length >= max) break;
    const g = groups.get(label);
    if (!g || g.length < min || g.length > maxShare * trials.length) continue;
    let best = -1;
    let bestN = 0;
    for (const i of g) {
      const p = points[i];
      let n = 0;
      for (const j of g) {
        const q = points[j];
        if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 <= r2) n++;
      }
      if (n > bestN) {
        bestN = n;
        best = i;
      }
    }
    if (best < 0 || bestN < minDensity * g.length) continue;
    out.push({ label, ...points[best] });
  }
  return out;
}

/**
 * Where to draw a centred label of ``width`` px anchored at (sx, sy) on a w × h canvas: on the anchor,
 * pulled in so the whole label (plus a 4px margin, and 10px vertically for the text's height) stays inside.
 */
export function labelPosition(sx: number, sy: number, width: number, w: number, h: number): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return { x: clamp(sx, width / 2 + 4, w - width / 2 - 4), y: clamp(sy, 10, h - 10) };
}

/** Line height (px) labels are kept apart by. */
const LABEL_LINE = 14;

/**
 * Place centred labels in order: each goes where labelPosition puts it, unless that box would touch one
 * already placed; then it is nudged down a line at a time to the first free slot (up to 8 lines; with
 * none free it keeps its own position). A greedy pass, cheap enough per frame for a handful of labels.
 */
export function placeLabels(
  items: { sx: number; sy: number; width: number }[],
  w: number,
  h: number,
): { x: number; y: number }[] {
  const placed: { x: number; y: number; width: number }[] = [];
  const hits = (x: number, y: number, width: number) =>
    placed.some((p) => Math.abs(p.x - x) < (p.width + width) / 2 + 6 && Math.abs(p.y - y) < LABEL_LINE);
  return items.map(({ sx, sy, width }) => {
    const home = labelPosition(sx, sy, width, w, h);
    let at = home;
    for (let k = 0; k <= 8; k++) {
      const cand = labelPosition(sx, sy + k * LABEL_LINE, width, w, h);
      if (!hits(cand.x, cand.y, width)) {
        at = cand;
        break;
      }
    }
    placed.push({ ...at, width });
    return at;
  });
}

/**
 * Which edge the phone label column takes: away from the labelled clusters, judged once from their
 * unrotated (fitted) positions so the column never jumps sides while the map turns. Right by default.
 */
export function columnSide(anchors: { x: number }[]): "left" | "right" {
  if (anchors.length === 0) return "right";
  const meanX = anchors.reduce((a, p) => a + p.x, 0) / anchors.length;
  return meanX > 0 ? "left" : "right";
}

/**
 * Phone layout for centred labels: a column stacked down from ``top`` on ``side`` (see columnSide), its
 * inner edge flush so every leader ends on one vertical line (``lx``, 3px off the column) and never runs
 * through another label. Labels keep the order of their dots' height, so the leaders do not cross.
 */
export function columnLabels(
  items: { sx: number; sy: number; width: number }[],
  w: number,
  top: number,
  side: "left" | "right",
): { x: number; y: number; lx: number }[] {
  if (items.length === 0) return [];
  const widest = Math.max(...items.map((it) => it.width));
  const right = side === "right";
  const inner = right ? w - 4 - widest : 4 + widest;
  const order = items.map((_, i) => i).sort((a, b) => items[a].sy - items[b].sy);
  const ys = new Array<number>(items.length);
  order.forEach((i, k) => (ys[i] = top + k * LABEL_LINE));
  return items.map((it, i) => ({
    x: right ? inner + it.width / 2 : inner - it.width / 2,
    y: ys[i],
    lx: right ? inner - 3 : inner + 3,
  }));
}

/** Start and end year with an en dash: "2014–2019", "2021–" (no end), "2021–2025 (est.)", "" when neither. */
export function yearSpan(t: ExplorerTrial): string {
  if (t.start_year === null && t.end_year === null) return "";
  const end = t.end_year === null ? "" : `${t.end_year}${t.end_estimated ? " (est.)" : ""}`;
  return `${t.start_year ?? ""}–${end}`;
}

/** The first n items joined with ", ", then "+k" for the rest. */
const firstOf = (items: string[], n: number): string =>
  items.slice(0, n).join(", ") + (items.length > n ? ` +${items.length - n}` : "");

/** The hover card's two lines: what the trial is, then what it tests, its phase and its years. */
export function popupLines(t: ExplorerTrial): [string, string] {
  const parts = [
    firstOf(t.drugs, 2),
    firstOf(t.treatment_types.slice(0, 2).map(treatmentLabel), 2),
    phaseLabel(t.phase),
    yearSpan(t),
  ];
  return [`${t.nct_id} · ${t.title}`, parts.filter((p) => p !== "").join(" · ")];
}

const POPUP_GAP = 10; // px between the dot and the card's near edge
const POPUP_MARGIN = 4; // px kept clear of the panel edge

/**
 * Top-left of a cardW x cardH card for a dot at (x, y) in a w x h panel: centred on the dot with its
 * bottom edge ``gap`` px above it, so the card never covers the dot or the marks just below it. Only
 * where that would cross the panel's top edge does it flip below (``below``), if it fits there.
 * Horizontally it is kept 4px inside the panel.
 */
export function popupPosition(
  x: number,
  y: number,
  cardW: number,
  cardH: number,
  w: number,
  h: number,
  gap = POPUP_GAP,
): { left: number; top: number; below: boolean } {
  const above = y - gap - cardH;
  // Below only when above crosses the top edge and below fits; a panel too short for either keeps it above.
  const below = above < POPUP_MARGIN && y + gap + cardH <= h - POPUP_MARGIN;
  const left = Math.max(POPUP_MARGIN, Math.min(w - cardW - POPUP_MARGIN, x - cardW / 2));
  return { left, top: below ? y + gap : Math.max(POPUP_MARGIN, above), below };
}
