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
  unknown: string;
  phases: Record<string, string>;
  diseases: string[];
}

export const LIGHT_PALETTE: Palette = {
  succeeded: "#c8102e",
  stopped: "#111111",
  completed_unknown: "#7d8a95",
  running: "#c3cbd1",
  unknown: "#e4e8eb",
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
  running: "#3d4147",
  unknown: "#2b2e33",
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

export function colorFor(
  t: ExplorerTrial,
  mode: ColorMode,
  palette: Palette,
  conditionOrder: string[],
): string {
  if (mode === "outcome") return palette[t.outcome];
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

const one = (n: number): string => n.toFixed(1);

export function liftSentence(s: ExplorerStats): string {
  if (s.verdict === "insufficient") return "Too few successes in this area to measure clustering yet.";
  if (s.verdict === "chance") return "Successful trials cluster no more than chance would.";
  const [lo, hi] = s.baseline_range ?? [NaN, NaN];
  return `Successful trials' neighbours succeed ${one(s.lift ?? NaN)}× more often than chance (shuffled: ${one(lo)}–${one(hi)}×).`;
}
