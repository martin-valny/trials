import type { DrugInfo, ExplorerCluster, ExplorerFile, ExplorerStats, ExplorerTrial, Outcome } from "../types";
import { phaseLabel, treatmentLabel } from "./format";

export type { DrugInfo } from "../types";

export type ColorMode = "outcome" | "phase" | "disease" | "mechanism" | "modality" | "approach";

export interface Filters {
  conditions: Set<string>;
  phases: Set<string>;
  outcomes: Set<Outcome>;
  treatmentTypes: Set<string>;
  /** Mechanism classes; NONE stands for trials with no known mechanism. */
  mechanisms: Set<string>;
  /** Modalities; NONE stands for trials with no known modality. */
  modalities: Set<string>;
  /** Approach keys; NONE stands for trials with no approach (a file built without the approach config). */
  approaches: Set<string>;
  query: string;
  /** On: only trials with results posted. Off (default): every trial, results or not. */
  resultsOnly: boolean;
  /** Inclusive start-year range. */
  years: [number, number];
}

export type SetKey =
  | "conditions"
  | "phases"
  | "outcomes"
  | "treatmentTypes"
  | "mechanisms"
  | "modalities"
  | "approaches";

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
  /** Mechanism and modality modes: a class outside the six that take the series (slate fill). */
  otherCategory: string;
  /** Mechanism and modality modes: a trial with more than one class, drawn as a hollow ink ring (hollowFor). */
  multiple: string;
  /** Mechanism and modality modes: no known class; the cloud's pale ground, as completed-unknown is. */
  noClass: string;
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
  otherCategory: "#8796a3",
  multiple: "#111111",
  noClass: "#c9d1d8",
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
  otherCategory: "#6c7f93",
  multiple: "#eceae4",
  noClass: "#50575f",
};

export const OUTCOMES: Outcome[] = ["succeeded", "stopped", "completed_unknown", "running", "unknown"];

/** Phase buckets in reading order; anything else sorts after these. */
export const PHASES = ["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"];

/** A trial's phase bucket for filtering; a missing phase counts as "NA". */
export const phaseKey = (t: ExplorerTrial): string => t.phase ?? "NA";

// --- Mechanism and modality -------------------------------------------------------------------------

/** Filter value for trials with no known mechanism (or modality). */
export const NONE = "__none__";

/** A trial's classes, or [NONE] when it has none: what filters and counts key it under. */
const orNone = (values: string[]): string[] => (values.length > 0 ? values : [NONE]);

/** Modalities in reading order; the first six take the colour series, "other" the other-category grey. */
export const MODALITIES = [
  "small molecule",
  "antibody",
  "protein",
  "oligonucleotide",
  "cell therapy",
  "gene therapy",
  "other",
];
const MODALITY_SERIES = MODALITIES.slice(0, 6);

/** "small molecule" -> "Small molecule"; NONE -> "No known modality". */
export const modalityLabel = (m: string): string =>
  m === NONE ? "No known modality" : m.charAt(0).toUpperCase() + m.slice(1);

/**
 * The file as the page uses it: each trial's modalities as one value each (split on ";", in order,
 * without repeats), and the phase 2 fields an older file lacks defaulted (empty lists, not in the pool).
 */
export function normalizeFile(f: ExplorerFile): ExplorerFile {
  // The pipeline already splits modalities; this stays as a guard for hand-made or older files.
  const split = (values: string[] | undefined) => [
    ...new Set((values ?? []).flatMap((v) => v.split(";").map((x) => x.trim())).filter((x) => x !== "")),
  ];
  return {
    ...f,
    // A file from before phase 2 (or before approaches) has none of these: default them so the page still works.
    approaches: f.approaches ?? [],
    clusters: f.clusters ?? [],
    drug_index: f.drug_index ?? {},
    kinds: f.kinds ?? {},
    trials: f.trials.map((t) => ({
      ...t,
      approaches: t.approaches ?? [],
      kinds: t.kinds ?? [],
      mechanisms: t.mechanisms ?? [],
      targets: t.targets ?? [],
      modalities: split(t.modalities),
      succeeded_by: t.succeeded_by ?? [],
      succeeded_in: t.succeeded_in ?? [],
      in_pool: t.in_pool ?? false,
      unsorted: t.unsorted ?? [],
    })),
  };
}

/** A mechanism class as shown; NONE -> "No known mechanism". */
export const mechanismLabel = (m: string): string => (m === NONE ? "No known mechanism" : m);

/** Modality keys present in ``counts``: the fixed order, then any other alphabetically, NONE last. */
export function modalitiesOf(counts: Map<string, number>): string[] {
  const rank = (k: string) => (k === NONE ? Infinity : MODALITIES.includes(k) ? MODALITIES.indexOf(k) : MODALITIES.length);
  return [...counts.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Mechanism keys present in ``counts`` by trial count (ties alphabetically), NONE last. */
export const mechanismsOf = (counts: Map<string, number>): string[] =>
  [...counts.keys()].sort(
    (a, b) => Number(a === NONE) - Number(b === NONE) || counts.get(b)! - counts.get(a)! || a.localeCompare(b),
  );

/**
 * The (up to) six commonest mechanism classes over every trial, by trial count (a trial counts in each class
 * it has), ties alphabetically: the classes that take the colour series, so colours never shift when filtering.
 */
export const mechanismSeries = (trials: ExplorerTrial[]): string[] =>
  mechanismsOf(tally(trials, (t) => t.mechanisms)).slice(0, 6);

/**
 * Mechanism or modality colour: none -> the pale ground (noClass); more than one -> multiple (an ink ring); one in ``series`` -> its
 * place in the series; any other -> the other-category grey. Never red.
 */
export function categoryColor(values: string[], palette: Palette, series: string[]): string {
  if (values.length === 0) return palette.noClass;
  if (values.length > 1) return palette.multiple;
  const i = series.indexOf(values[0]);
  return i < 0 ? palette.otherCategory : palette.diseases[i % palette.diseases.length];
}

/** The colour series for a category mode: mechanism uses ``mechanisms`` (mechanismSeries), modality the fixed order. */
export const categorySeries = (mode: "mechanism" | "modality", mechanisms: string[]): string[] =>
  mode === "mechanism" ? mechanisms : MODALITY_SERIES;

/** Panel d's mechanism part: the first class, "+n" for the rest; null when none. */
export const mechanismText = (t: ExplorerTrial): string | null =>
  t.mechanisms.length === 0 ? null : firstOf(t.mechanisms, 1);

/** Panel d's targets part: "Targets: A, B, C +2"; null when none. */
export const targetsText = (t: ExplorerTrial): string | null =>
  t.targets.length === 0 ? null : `Targets: ${firstOf(t.targets, 3)}`;

/** Panel d's modality part, as mechanismText. */
export const modalityText = (t: ExplorerTrial): string | null =>
  t.modalities.length === 0 ? null : firstOf(t.modalities.map(modalityLabel), 1);

/** True when a trial with these classes is painted a series colour: exactly one, and it is in ``series``. */
const inSeries = (values: string[], series: string[]): boolean => values.length === 1 && series.includes(values[0]);

/**
 * The classes some trial is painted as: those a trial has as its only class, plus NONE when some trial
 * has none. The key and the dropdown swatches show only these.
 */
export function paintedClasses(trials: ExplorerTrial[], mode: "mechanism" | "modality" | "approach"): Set<string> {
  const out = new Set<string>();
  for (const t of trials) {
    const v = mode === "mechanism" ? t.mechanisms : mode === "modality" ? t.modalities : t.approaches;
    if (v.length === 0) out.add(NONE);
    else if (v.length === 1) out.add(v[0]);
  }
  return out;
}

/** Fewest trials a named cluster needs for a label on the map. */
export const CLUSTER_LABEL_MIN_N = 15;

/** Share of the label slots reserved for mechanism-named clusters: 5 of 8 side by side, 4 of 6 on a phone. */
const MECHANISM_SLOT_SHARE = 0.6;

/**
 * The named clusters labelled on the map, at most ``max`` (8 side by side, 6 on a phone) so the labels
 * never crowd the cloud. Only clusters with at least ``minN`` trials, each label once (its largest
 * instance). Slots are reserved by kind: mechanism-named clusters get ``ceil(0.6 × max)``, type-named
 * the rest, each kind largest first; a kind with fewer clusters than its share gives the spare slots to
 * the other, and mixed clusters fill whatever remains. Mechanism labels come first, then type, then mixed.
 */
export function clusterLabels(clusters: ExplorerCluster[], max: number, minN = CLUSTER_LABEL_MIN_N): ClusterAnchor[] {
  const bySize = clusters.filter((c) => c.n >= minN).sort((a, b) => b.n - a.n || a.id - b.id);
  // Each label once: its largest instance.
  const seen = new Set<string>();
  const unique: ExplorerCluster[] = [];
  for (const c of bySize) {
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    unique.push(c);
  }
  const mech = unique.filter((c) => c.kind === "mechanism");
  const type = unique.filter((c) => c.kind === "type");
  // A cluster with no kind (a file from before kinds were exported) counts as mixed.
  const mixed = unique.filter((c) => c.kind !== "mechanism" && c.kind !== "type");
  const mechSlots = Math.ceil(max * MECHANISM_SLOT_SHARE);
  const nMech = Math.min(mech.length, max - Math.min(type.length, max - mechSlots)); // plus spare type slots
  const nType = Math.min(type.length, max - nMech); // plus spare mechanism slots
  const nMixed = Math.max(0, max - nMech - nType);
  return [...mech.slice(0, nMech), ...type.slice(0, nType), ...mixed.slice(0, nMixed)].map(({ label, x, y, z }) => ({
    label,
    x,
    y,
    z,
  }));
}

// --- end mechanism and modality ---------------------------------------------------------------------

// --- Approaches ---------------------------------------------------------------------------------------

/**
 * The six approaches that take the colour series, in the vocabulary's order (the disease series hues,
 * so no ink and no red). Unclassified is not among them: it takes the cloud's pale ground, as "no known
 * mechanism" does.
 */
export const APPROACH_SERIES = ["targeted", "cell", "plasma", "tolerisation", "diffuse", "nondrug"];

/** The approach a trial lands in when it is in no other. */
export const UNCLASSIFIED = "unclassified";

/** An approach key as shown: its label in the file, NONE -> "No approach", an unknown key as itself. */
export const approachLabel = (key: string, f: Pick<ExplorerFile, "approaches">): string =>
  key === NONE ? "No approach" : (f.approaches.find((a) => a.key === key)?.label ?? key);

/** Approach keys present in ``counts`` in the file's order, unknown keys after alphabetically, NONE last. */
export function approachesOf(counts: Map<string, number>, f: Pick<ExplorerFile, "approaches">): string[] {
  const order = f.approaches.map((a) => a.key);
  const rank = (k: string) => (k === NONE ? Infinity : order.includes(k) ? order.indexOf(k) : order.length);
  return [...counts.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Approach colour: Unclassified and none take the pale ground; otherwise as categoryColor. */
export function approachColor(approaches: string[], palette: Palette): string {
  if (approaches.length === 1 && approaches[0] === UNCLASSIFIED) return palette.noClass;
  return categoryColor(approaches, palette, APPROACH_SERIES);
}

/** The names the hover card and panel d use for approaches and kinds. */
export type ApproachNames = Pick<ExplorerFile, "approaches" | "kinds"> & Partial<Pick<ExplorerFile, "drug_index">>;

/**
 * Each of a trial's approaches with its kinds in brackets: "Targeted drugs; Non-drug care (other
 * behavioural, other device)". One part per approach; empty when the trial has none.
 */
export function approachParts(t: ExplorerTrial, names: ApproachNames): string[] {
  return t.approaches.map((a) => {
    const kinds = t.kinds.filter((k) => names.kinds[k]?.approach === a).map((k) => names.kinds[k].label);
    const label = approachLabel(a, names);
    return kinds.length > 0 ? `${label} (${kinds.join(", ")})` : label;
  });
}

/** Panel d's approach part: every approach with its kinds; null when none. */
export function approachText(t: ExplorerTrial, names: ApproachNames): string | null {
  const parts = approachParts(t, names);
  return parts.length === 0 ? null : parts.join("; ");
}

// --- end approaches ---------------------------------------------------------------------------------

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
    mechanisms: tally(trials, (t) => orNone(t.mechanisms)),
    modalities: tally(trials, (t) => orNone(t.modalities)),
    approaches: tally(trials, (t) => orNone(t.approaches)),
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
  ["mechanism", "Mechanism"],
  ["modality", "Modality"],
  ["approach", "Approach"],
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
    sameSet(a.mechanisms, b.mechanisms) &&
    sameSet(a.modalities, b.modalities) &&
    sameSet(a.approaches, b.approaches) &&
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
  const mechanisms = new Set<string>([NONE]);
  const modalities = new Set<string>([NONE]);
  const approaches = new Set<string>([NONE]);
  for (const t of trials) {
    t.condition_labels.forEach((l) => conditions.add(l));
    phases.add(phaseKey(t));
    t.treatment_types.forEach((x) => treatmentTypes.add(x));
    t.mechanisms.forEach((x) => mechanisms.add(x));
    t.modalities.forEach((x) => modalities.add(x));
    t.approaches.forEach((x) => approaches.add(x));
  }
  return {
    conditions,
    phases,
    outcomes: new Set(OUTCOMES),
    treatmentTypes,
    mechanisms,
    modalities,
    approaches,
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
  if (!orNone(t.mechanisms).some((x) => f.mechanisms.has(x))) return false;
  if (!orNone(t.modalities).some((x) => f.modalities.has(x))) return false;
  if (!orNone(t.approaches).some((x) => f.approaches.has(x))) return false;
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
 * conditions are not buried under the large one; in mechanism and modality modes the trials painted a
 * series colour (one class, among ``mechanisms`` or the modality series); in approach mode the trials in
 * one hued approach (not Unclassified); none in phase mode.
 */
export function emphasisFor(
  mode: ColorMode,
  ranked: string[],
  mechanisms: string[] = [],
): ((t: ExplorerTrial) => boolean) | undefined {
  if (mode === "outcome") return (t) => t.outcome === "succeeded";
  if (mode === "disease") return (t) => t.condition_labels.length > 0 && t.condition_labels[0] !== ranked[0];
  if (mode === "mechanism") return (t) => inSeries(t.mechanisms, mechanisms);
  if (mode === "modality") return (t) => inSeries(t.modalities, MODALITY_SERIES);
  if (mode === "approach") return (t) => inSeries(t.approaches, APPROACH_SERIES);
  return undefined;
}

/**
 * Which trials are drawn as a hollow 1px ring instead of a filled dot (Shape-Not-Shade): unknown outcomes
 * in outcome mode; in mechanism, modality and approach modes, trials with more than one class. None otherwise.
 */
export function hollowFor(mode: ColorMode): ((t: ExplorerTrial) => boolean) | undefined {
  if (mode === "outcome") return (t) => t.outcome === "unknown";
  if (mode === "mechanism") return (t) => t.mechanisms.length > 1;
  if (mode === "modality") return (t) => t.modalities.length > 1;
  if (mode === "approach") return (t) => t.approaches.length > 1;
  return undefined;
}

/**
 * ``series`` is the disease colour order (diseaseSeries), used in disease mode only; ``mechanisms`` the
 * classes that take the series in mechanism mode (mechanismSeries).
 */
export function colorFor(
  t: ExplorerTrial,
  mode: ColorMode,
  palette: Palette,
  series: string[],
  mechanisms: string[] = [],
): string {
  if (mode === "outcome") return outcomeColor(t.outcome, palette);
  if (mode === "phase") return (t.phase && palette.phases[t.phase]) || palette.unknown;
  if (mode === "mechanism") return categoryColor(t.mechanisms, palette, mechanisms);
  if (mode === "modality") return categoryColor(t.modalities, palette, MODALITY_SERIES);
  if (mode === "approach") return approachColor(t.approaches, palette);
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

export type SuccessBy = "disease" | "modality" | "mechanism" | "approach";
export interface SuccessGroup {
  group: string;
  finished: number;
  succeeded: number;
  rate: number | null;
  /** Present (false) only for Non-drug care By approach: success means a drug moved on, so no share. */
  successDefined?: false;
}

/** The approach with no success rule: no drug moves on, so there is no share to show. */
export const NONDRUG = "nondrug";

/** The groups a trial touches in a grouping: its conditions, modalities, mechanism classes or approaches. */
export function groupsOf(t: ExplorerTrial, by: SuccessBy): string[] {
  if (by === "disease") return t.condition_labels;
  if (by === "modality") return t.modalities;
  if (by === "mechanism") return t.mechanisms;
  return t.approaches;
}

/** A drug's groups in a grouping (modalities split on ";", as normalizeFile splits a trial's). */
const drugGroups = (d: DrugInfo, by: Exclude<SuccessBy, "disease">): string[] =>
  by === "modality"
    ? d.modalities.flatMap((m) => m.split(";").map((x) => x.trim()))
    : by === "mechanism"
      ? d.mechanisms
      : d.approaches;

/**
 * True when a trial counts as a success in ``group`` (1b: success is credited to the drug that moved on).
 * Disease groups use succeeded_in (R21: only where the drug moved on). Every other grouping credits a
 * succeeded trial only to the groups of a drug in its succeeded_by, looked up in ``drugIndex``: an aHSCT
 * + cyclophosphamide trial that succeeded because cyclophosphamide moved on is a success for alkylating
 * agents and Targeted drugs, not for Cell & transplant. A file from before succeeded_by (empty on a
 * succeeded trial) credits the trial's own outcome, as before.
 */
export function wonIn(t: ExplorerTrial, by: SuccessBy, group: string, drugIndex: Record<string, DrugInfo>): boolean {
  if (by === "disease") return t.succeeded_in.includes(group);
  if (t.outcome !== "succeeded") return false;
  if (t.succeeded_by.length === 0) return groupsOf(t, by).includes(group);
  return t.succeeded_by.some((d) => {
    const info = drugIndex[d];
    return info !== undefined && drugGroups(info, by).includes(group);
  });
}

/**
 * Panel b grouping: finished trials that could succeed (the pool), counted in the denominator of every
 * group they touch. With ``drugIndex`` a success counts only in the groups of the drug that moved on
 * (wonIn); without it, the trial's own outcome (disease groups always use succeeded_in).
 * `rate` is null below minGroup, and always for Non-drug care By approach (success not defined; its
 * succeeded count is 0). Sorted by finished desc, capped at topN.
 * `order` is for the disease view only: it keeps that area order, lists every group even with none finished,
 * and disables sorting and topN.
 */
export function successGroups(
  trials: ExplorerTrial[],
  by: SuccessBy,
  minGroup: number,
  topN = 8,
  order?: string[],
  drugIndex?: Record<string, DrugInfo>,
): SuccessGroup[] {
  const acc = new Map<string, { finished: number; succeeded: number }>();
  for (const g of order ?? []) acc.set(g, { finished: 0, succeeded: 0 });
  for (const t of trials) {
    if (!t.in_pool) continue;
    for (const g of new Set(groupsOf(t, by))) {
      const row = acc.get(g) ?? { finished: 0, succeeded: 0 };
      row.finished += 1;
      const won =
        by === "disease"
          ? t.succeeded_in.includes(g)
          : drugIndex === undefined
            ? t.outcome === "succeeded"
            : wonIn(t, by, g, drugIndex);
      if (won) row.succeeded += 1;
      acc.set(g, row);
    }
  }
  const rows: SuccessGroup[] = [...acc].map(([group, r]) =>
    by === "approach" && group === NONDRUG
      ? { group, finished: r.finished, succeeded: 0, rate: null, successDefined: false }
      : { group, ...r, rate: r.finished >= minGroup && r.finished > 0 ? r.succeeded / r.finished : null },
  );
  if (order) return rows;
  return rows.sort((a, b) => b.finished - a.finished || a.group.localeCompare(b.group)).slice(0, topN);
}

/**
 * Panel b By approach rows in the approach vocabulary's order, Unclassified last, so the rail, the
 * Approach key and panel b list the approaches the same way. Groups outside the vocabulary follow, by name.
 */
export function inApproachOrder(rows: SuccessGroup[], approaches: readonly { key: string }[]): SuccessGroup[] {
  const keys = approaches.map((a) => a.key).filter((k) => k !== UNCLASSIFIED);
  const rank = (g: string): number => {
    if (g === UNCLASSIFIED) return keys.length + 1;
    const i = keys.indexOf(g);
    return i === -1 ? keys.length : i;
  };
  return [...rows].sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group));
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
 * One anchor per condition in the configured order, at its own densest region: among the trials whose
 * FIRST condition label is that condition, the one with the most same-condition trials within ``radius``,
 * weighted by their share of all trials there (n² / all), so a condition is not anchored in the shared
 * centre where every condition overlaps.
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
  const near = (p: { x: number; y: number; z: number }, q: typeof p) =>
    (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 <= r2;
  for (const label of conditionOrder) {
    if (out.length >= max) break;
    const g = groups.get(label);
    if (!g || g.length < min || g.length > maxShare * trials.length) continue;
    let best = -1;
    let bestN = 0;
    let bestScore = 0;
    for (const i of g) {
      const p = points[i];
      let n = 0;
      let all = 0;
      for (const j of g) if (near(p, points[j])) n++;
      for (const q of points) if (near(p, q)) all++;
      // Same-condition neighbours weighted by their share of all neighbours: the condition's own
      // region, not the shared centre where every condition overlaps.
      const score = (n * n) / Math.max(1, all);
      if (score > bestScore) {
        bestScore = score;
        bestN = n;
        best = i;
      }
    }
    if (best < 0 || bestN < minDensity * g.length) continue;
    out.push({ label, ...points[best] });
  }
  return out;
}

/** Line height (px) of a canvas label; its box is this tall, centred on ``y``. */
export const LABEL_LINE = 14;
/** Longest leader (px) from an anchor to a label beside it; a label that cannot fit becomes a callout. */
export const LEADER_MAX = 48;
const LABEL_PAD = 3; // px kept clear around each label box
const LEADER_STEPS = [6, 18, 32, LEADER_MAX];
const DOT_REACH = 3; // px: a typical dot radius, so a label clears dot edges, not just centres
const MAX_COVERED = 3; // dots a label box may cover before the spot counts as no fit
// Directions tried around each anchor, in order of preference: east first, as a figure label reads.
const DIRECTIONS: [number, number][] = [
  [1, 0], [1, -1], [1, 1], [0, -1], [0, 1], [-1, -1], [-1, 1], [-1, 0],
];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LabelItem {
  /** Stable name (the label text), so a label keeps its side from frame to frame while the map turns. */
  key: string;
  ax: number;
  ay: number;
  width: number;
}

export interface LabelSpot {
  /** Left edge of the text and its vertical centre. */
  left: number;
  y: number;
  /** Where the leader from the anchor meets the label box. */
  lx: number;
  ly: number;
  /** True when set in the margin outside the cloud, with a longer leader. */
  callout: boolean;
}

export interface PlaceOptions {
  /** Visible dots, on screen: a label is set where it covers the fewest. */
  dots?: { sx: number; sy: number }[];
  /** Boxes no label may touch (the control band). */
  obstacles?: Box[];
  /** Each label's last choice, by key (an index into the candidates, or -1 for a callout); updated in place. */
  memory?: Map<string, number>;
}

const hitBox = (a: Box, b: Box, pad = 0) =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** True when segment p-q crosses (or touches) the box. Liang-Barsky clip. */
function segmentHitsBox(px: number, py: number, qx: number, qy: number, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dy = qy - py;
  const edges: [number, number][] = [
    [-dx, px - b.x0],
    [dx, b.x1 - px],
    [-dy, py - b.y0],
    [dy, b.y1 - py],
  ];
  for (const [pp, qq] of edges) {
    if (pp === 0) {
      if (qq < 0) return false;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

/** True when segments a-b and c-d cross properly. */
function segmentsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o = (p: number[], q: number[], r: number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Dots bucketed in 10px cells, to count exactly the dots whose centres fall in a label box. */
function dotGrid(dots: { sx: number; sy: number }[], w: number, h: number) {
  const C = 10;
  const cols = Math.max(1, Math.ceil(w / C));
  const rows = Math.max(1, Math.ceil(h / C));
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  dots.forEach((d, i) => {
    const c = Math.floor(d.sx / C);
    const r = Math.floor(d.sy / C);
    if (c >= 0 && c < cols && r >= 0 && r < rows) cells[r * cols + c].push(i);
  });
  return (b: Box): number => {
    let sum = 0;
    const c0 = Math.max(0, Math.floor(b.x0 / C));
    const c1 = Math.min(cols - 1, Math.floor(b.x1 / C));
    const r0 = Math.max(0, Math.floor(b.y0 / C));
    const r1 = Math.min(rows - 1, Math.floor(b.y1 / C));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        for (const i of cells[r * cols + c]) {
          const d = dots[i];
          if (d.sx >= b.x0 && d.sx <= b.x1 && d.sy >= b.y0 && d.sy <= b.y1) sum++;
        }
    return sum;
  };
}

/** The box a label of ``width`` takes when pushed ``d`` px from (ax, ay) along direction (ux, uy). */
function candidateBox(ax: number, ay: number, width: number, ux: number, uy: number, d: number): Box {
  const k = ux !== 0 && uy !== 0 ? Math.SQRT1_2 : 1;
  const px = ax + ux * d * k;
  const py = ay + uy * d * k;
  const x0 = ux > 0 ? px : ux < 0 ? px - width : px - width / 2;
  const half = LABEL_LINE / 2;
  const y0 = uy > 0 ? py : uy < 0 ? py - LABEL_LINE : py - half;
  return { x0, y0, x1: x0 + width, y1: y0 + LABEL_LINE };
}

const leaderEnd = (ax: number, ay: number, b: Box) => ({
  lx: Math.min(b.x1, Math.max(b.x0, ax)),
  ly: Math.min(b.y1, Math.max(b.y0, ay)),
});

/**
 * Place labels in order, each beside its anchor: 8 directions at up to four distances (leaders at most
 * 48px), scored by the dots the box would cover, the dots its leader runs through, the distance, and
 * crossing other leaders; a box may never
 * cover more than a few dots, touch another label, an obstacle or the canvas edge, and a leader may never
 * run through another label.
 * A label with no such spot goes to a margin callout beside the cloud's box (any side), where its leader
 * crosses the fewest dots;
 * with no room there either it is dropped (null), never drawn over another. ``memory`` keeps each label's
 * last choice preferred, so labels do not flicker between sides while the map turns.
 */
export function placeLabels(items: LabelItem[], w: number, h: number, opts: PlaceOptions = {}): (LabelSpot | null)[] {
  const { dots = [], obstacles = [], memory } = opts;
  const cover = dotGrid(dots, w, h);
  const boxes: Box[] = [];
  const leaders: [number[], number[]][] = [];
  const inCanvas = (b: Box) => b.x0 >= 2 && b.y0 >= 2 && b.x1 <= w - 2 && b.y1 <= h - 2;
  const free = (b: Box, ax: number, ay: number, lx: number, ly: number) =>
    inCanvas(b) &&
    !obstacles.some((o) => hitBox(b, o)) &&
    !boxes.some((o) => hitBox(b, o, LABEL_PAD)) &&
    !boxes.some((o) => segmentHitsBox(ax, ay, lx, ly, o)) &&
    !leaders.some(([p, q]) => segmentHitsBox(p[0], p[1], q[0], q[1], b));
  // The cloud's box, for callouts: the dots' extent, or the anchors' when there are no dots.
  // The cloud's box for callouts, trimmed to the 1st-99th percentile on each axis (as the still
  // view's fit is), so a few outliers do not push callouts off the canvas.
  const src = dots.length > 0 ? dots : items.map((i) => ({ sx: i.ax, sy: i.ay }));
  let hull = { x0: w / 2, x1: w / 2, y0: h / 2, y1: h / 2 };
  if (src.length > 0) {
    const xs = src.map((d) => d.sx).sort((a, b) => a - b);
    const ys = src.map((d) => d.sy).sort((a, b) => a - b);
    const at = (v: number[], p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
    hull = { x0: at(xs, 0.01), x1: at(xs, 0.99), y0: at(ys, 0.01), y1: at(ys, 0.99) };
  }
  /** Dots near the segment from (ax, ay) to (lx, ly), sampled every 5px through the grid. */
  const alongLeader = (ax: number, ay: number, lx: number, ly: number): number => {
    const n = Math.max(1, Math.ceil(Math.hypot(lx - ax, ly - ay) / 5));
    let sum = 0;
    for (let i = 1; i <= n; i++) {
      const x = ax + ((lx - ax) * i) / n;
      const y = ay + ((ly - ay) * i) / n;
      sum += cover({ x0: x - 2.5, x1: x + 2.5, y0: y - 2.5, y1: y + 2.5 });
    }
    return sum;
  };

  return items.map(({ key, ax, ay, width }) => {
    let best: { b: Box; lx: number; ly: number; score: number; idx: number } | null = null;
    let idx = 0;
    for (const d of LEADER_STEPS) {
      for (const [ux, uy] of DIRECTIONS) {
        const b = candidateBox(ax, ay, width, ux, uy, d);
        const { lx, ly } = leaderEnd(ax, ay, b);
        // Dots are discs: count those within a dot's radius of the box, not only centres inside it.
        const covered = cover({ x0: b.x0 - DOT_REACH, y0: b.y0 - DOT_REACH, x1: b.x1 + DOT_REACH, y1: b.y1 + DOT_REACH });
        // A label over the cloud's dots is unreadable: more than a few, and the spot is not a fit.
        if (covered <= MAX_COVERED && free(b, ax, ay, lx, ly)) {
          const crossings = leaders.filter(([p, q]) => segmentsCross(p, q, [ax, ay], [lx, ly])).length;
          const score =
            4 * covered + 1.5 * alongLeader(ax, ay, lx, ly) + 0.6 * d + 0.4 * DIRECTIONS.findIndex(([x, y]) => x === ux && y === uy) + 30 * crossings -
            (memory?.get(key) === idx ? 8 : 0);
          if (best === null || score < best.score) best = { b, lx, ly, score, idx };
        }
        idx++;
      }
    }
    if (best !== null) {
      memory?.set(key, best.idx);
      boxes.push(best.b);
      leaders.push([[ax, ay], [best.lx, best.ly]]);
      return { left: best.b.x0, y: (best.b.y0 + best.b.y1) / 2, lx: best.lx, ly: best.ly, callout: false };
    }
    // Margin callout: beside the cloud's box (left, right, above or below), wherever its leader crosses
    // the fewest dots, then nearest the anchor.
    let call: { b: Box; lx: number; ly: number; score: number } | null = null;
    const consider = (b: Box) => {
      const { lx, ly } = leaderEnd(ax, ay, b);
      if (!free(b, ax, ay, lx, ly)) return;
      const len = Math.hypot(lx - ax, ly - ay);
      const score = 3 * alongLeader(ax, ay, lx, ly) + 0.25 * len;
      if (call === null || score < call.score) call = { b, lx, ly, score };
    };
    const half = LABEL_LINE / 2;
    for (let k = -Math.ceil(h / LABEL_LINE); k <= Math.ceil(h / LABEL_LINE); k++) {
      const y = ay + k * LABEL_LINE;
      consider({ x0: hull.x1 + 10, x1: hull.x1 + 10 + width, y0: y - half, y1: y + half });
      consider({ x0: hull.x0 - 10 - width, x1: hull.x0 - 10, y0: y - half, y1: y + half });
    }
    for (let k = -Math.ceil(w / 24); k <= Math.ceil(w / 24); k++) {
      const x0 = ax - width / 2 + k * 12;
      consider({ x0, x1: x0 + width, y0: hull.y0 - 10 - LABEL_LINE, y1: hull.y0 - 10 });
      consider({ x0, x1: x0 + width, y0: hull.y1 + 10, y1: hull.y1 + 10 + LABEL_LINE });
    }
    if (call !== null) {
      const c: { b: Box; lx: number; ly: number } = call;
      memory?.set(key, -1);
      boxes.push(c.b);
      leaders.push([[ax, ay], [c.lx, c.ly]]);
      return { left: c.b.x0, y: (c.b.y0 + c.b.y1) / 2, lx: c.lx, ly: c.ly, callout: true };
    }
    return null;
  });
}

/** "<disease> · anti-CD20 (ocrelizumab)" -> ["<disease> · ", "anti-CD20 (ocrelizumab)"]: the disease prefix is set quieter. */
export function splitLabel(label: string): [string, string] {
  const i = label.indexOf(" · ");
  return i < 0 ? ["", label] : [label.slice(0, i + 3), label.slice(i + 3)];
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

/**
 * The hover card's two lines: what the trial is, then what it tests (with its approach and kind when
 * ``names`` are given), its phase and its years.
 */
export function popupLines(t: ExplorerTrial, names?: ApproachNames): [string, string] {
  const parts = [
    firstOf(t.drugs, 2),
    firstOf(t.mechanisms, 1),
    firstOf(t.modalities.map(modalityLabel), 1),
    names ? firstOf(approachParts(t, names), 1) : "",
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
