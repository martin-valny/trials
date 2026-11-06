import type { ExplorerFile, ExplorerStats, ExplorerTrial, Outcome } from "../types";

export type ColorMode = "outcome" | "phase" | "disease";

export interface Filters {
  conditions: Set<string>;
  phases: Set<string>;
  outcomes: Set<Outcome>;
  treatmentTypes: Set<string>;
  query: string;
}

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
  diseases: string[];
}

export const LIGHT_PALETTE: Palette = {
  succeeded: "#c8102e",
  stopped: "#111111",
  completed_unknown: "#7d8a95",
  running: "#9aa6b0",
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
  diseases: ["#111111", "#7a5c2e", "#e07a5f", "#3b6ea5", "#7aa6c2", "#8a8f94"],
};

export const DARK_PALETTE: Palette = {
  succeeded: "#ff8a3d",
  stopped: "#eceae4",
  completed_unknown: "#7d8287",
  running: "#5f666e",
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
  diseases: ["#eceae4", "#c8a96a", "#7fb2e5", "#e5c07b", "#8fc29a", "#7d8287"],
};

export const OUTCOMES: Outcome[] = ["succeeded", "stopped", "completed_unknown", "running", "unknown"];

/** Phase buckets in reading order; anything else sorts after these. */
export const PHASES = ["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"];

/** A trial's phase bucket for filtering; a missing phase counts as "NA". */
export const phaseKey = (t: ExplorerTrial): string => t.phase ?? "NA";

/** Disease colour for a condition label, by its position in the area's condition order. */
export function diseaseColor(label: string | undefined, palette: Palette, conditionOrder: string[]): string {
  const i = label === undefined ? -1 : conditionOrder.indexOf(label);
  return i < 0 ? palette.unknown : palette.diseases[i % palette.diseases.length];
}

/** Filters with every value present in the file switched on. */
export function allFilters(f: ExplorerFile): Filters {
  const conditions = new Set<string>(f.stats.by_condition.map((c) => c.label));
  const phases = new Set<string>();
  const treatmentTypes = new Set<string>();
  for (const t of f.trials) {
    t.condition_labels.forEach((l) => conditions.add(l));
    phases.add(phaseKey(t));
    t.treatment_types.forEach((x) => treatmentTypes.add(x));
  }
  return { conditions, phases, outcomes: new Set(OUTCOMES), treatmentTypes, query: "" };
}

/** A trial with no labels or no types cannot be filtered out by those sets. */
export function matches(t: ExplorerTrial, f: Filters): boolean {
  if (t.condition_labels.length > 0 && !t.condition_labels.some((l) => f.conditions.has(l))) return false;
  if (!f.phases.has(phaseKey(t))) return false;
  if (!f.outcomes.has(t.outcome)) return false;
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

export function colorFor(
  t: ExplorerTrial,
  mode: ColorMode,
  palette: Palette,
  conditionOrder: string[],
): string {
  if (mode === "outcome") return outcomeColor(t.outcome, palette);
  if (mode === "phase") return (t.phase && palette.phases[t.phase]) || palette.unknown;
  return diseaseColor(t.condition_labels[0], palette, conditionOrder);
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

export function liftSentence(s: ExplorerStats): string {
  if (s.verdict === "insufficient") return "Too few successes in this area to measure clustering yet.";
  if (s.verdict === "chance") return "Successful trials cluster no more than chance would.";
  const [lo, hi] = s.baseline_range ?? [NaN, NaN];
  const lift = s.lift ?? NaN;
  const base = `Successful trials' neighbours succeed ${two(lift)}× more often than chance (shuffled: ${two(lo)}–${two(hi)}×)`;
  // A lift barely past the shuffled maximum is real but slight; say so.
  return lift < 1.1 * hi ? `${base} — just above the shuffled range.` : `${base}.`;
}

export interface ClusterAnchor {
  label: string;
  x: number;
  y: number;
  z: number;
}

/**
 * One anchor per condition in the configured order: the 3D centroid of the trials whose FIRST
 * condition label is that condition. Conditions with fewer than ``min`` such trials get no anchor;
 * at most ``max`` anchors are returned. ``points`` are the trials' positions, index-aligned.
 */
export function clusterAnchors(
  trials: ExplorerTrial[],
  points: { x: number; y: number; z: number }[],
  conditionOrder: string[],
  min = 5,
  max = 6,
): ClusterAnchor[] {
  const sums = new Map<string, { n: number; x: number; y: number; z: number }>();
  trials.forEach((t, i) => {
    const label = t.condition_labels[0];
    if (label === undefined) return;
    const s = sums.get(label) ?? { n: 0, x: 0, y: 0, z: 0 };
    s.n += 1;
    s.x += points[i].x;
    s.y += points[i].y;
    s.z += points[i].z;
    sums.set(label, s);
  });
  const out: ClusterAnchor[] = [];
  for (const label of conditionOrder) {
    const s = sums.get(label);
    if (!s || s.n < min) continue;
    out.push({ label, x: s.x / s.n, y: s.y / s.n, z: s.z / s.n });
    if (out.length >= max) break;
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
 * already placed; then it moves by whole lines (down 1, up 1, down 2, up 2, …) to the first free slot.
 * With no free slot nearby it keeps its own position. Cheap enough per frame for a handful of labels.
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
      const step = k === 0 ? 0 : Math.ceil(k / 2) * (k % 2 ? 1 : -1);
      const cand = labelPosition(sx, sy + step * LABEL_LINE, width, w, h);
      if (!hits(cand.x, cand.y, width)) {
        at = cand;
        break;
      }
    }
    placed.push({ ...at, width });
    return at;
  });
}
