// The pipeline figure (pipeline.json): URL state, what a mark shows, row totals and sorting, the headline
// and margin notes, and the target page's groupings. Pure functions over the PipelineFile, so the page
// only reads their results (spec 2026-11-08 §7.1, §7.1a, §7.2).
import type { MarkState, PipelineFile, PipelineMark, PipelineRow, SponsorKind } from "../types";

export const HISTORICAL_MAX_RUNNING = 1;
export const HISTORICAL_MIN_TRIALS = 12;
export const NEWEST_YEARS = 5;
export const MAX_NOTES = 4;
export const LANE_MIN_TRIALS = 4;
export const COMPANIES_ON_ROW = 3;
export const COMPANIES_ON_TARGET = 7;
export const STOPS_SHOWN = 6;

const MOST_CROWDED_MIN = 5;
const NEWEST_MIN_TRIALS = 5;
const NEWEST_MIN_SHARE = 0.6;
const MOST_ADVANCED_MIN = 3;
const MOST_STOPPED_MIN = 5;
const SPREADING_MIN = 3;
/** Largest share "Other" may take of the stop reasons before the group chips are hidden. */
const OTHER_MAX_SHARE = 0.15;

export const MARK_LABEL: Record<MarkState, string> = {
  adv: "Advanced to next phase",
  run: "Still running",
  stop: "Stopped",
  fin: "Finished, no follow-on",
  unk: "Status unknown",
};

export type Arrangement = "phase" | "disease";
export type SortKey = "run" | "adv" | "new" | "az";

const SORTS: readonly SortKey[] = ["run", "adv", "new", "az"];
const VIEWS: readonly Arrangement[] = ["phase", "disease"];

export interface FigureState {
  disease: string | null;
  company: string | null;
  sort: SortKey;
  view: Arrangement;
}

export const DEFAULT_FIGURE_STATE: FigureState = { disease: null, company: null, sort: "run", view: "phase" };

/** Casefolded, whitespace-collapsed key: sponsors that differ only by case are one company. */
export const normKey = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

const n = (x: number): string => x.toLocaleString("en-US");
const plural = (k: number, one: string, many: string): string => (k === 1 ? one : many);

interface Parent {
  name: string;
  kind: SponsorKind;
}

/** The mark's sponsor parent (a missing sponsor index reads as an unnamed other). */
function parentOf(f: PipelineFile, m: PipelineMark): Parent {
  const sp = f.sponsors[m.sp];
  return sp ? { name: sp.parent, kind: sp.kind } : { name: "Unknown sponsor", kind: "other" };
}

const mark_si = (m: PipelineMark): string[] => m.si ?? [];

/** The state a mark is drawn in. Advanced follows R21: under a disease, only if it advanced there. */
export function markState(m: PipelineMark, disease: string | null): MarkState {
  if (m.s === "adv" && disease !== null && !mark_si(m).includes(disease)) return "fin";
  return m.s;
}

// ---------------------------------------------------------------- companies

interface CompanyInfo {
  key: string;
  name: string;
  kind: SponsorKind;
  trials: number;
}

/** Distinct parents (by normalised key) with the trials they have in rows. Industry wins a mixed key. */
function companyInfos(f: PipelineFile): CompanyInfo[] {
  const byKey = new Map<string, CompanyInfo>();
  const trials = new Map<string, Set<string>>();
  const variants = new Map<string, Map<string, number>>();
  f.sponsors.forEach((sp) => {
    const key = normKey(sp.parent);
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, { key, name: sp.parent, kind: sp.kind, trials: 0 });
    else if (cur.kind !== "industry" && sp.kind === "industry") cur.kind = "industry";
  });
  for (const r of f.rows)
    for (const m of r.marks) {
      const p = parentOf(f, m);
      const key = normKey(p.name);
      if (!byKey.has(key)) byKey.set(key, { key, name: p.name, kind: p.kind, trials: 0 });
      let set = trials.get(key);
      if (!set) trials.set(key, (set = new Set()));
      set.add(m.n);
      let v = variants.get(key);
      if (!v) variants.set(key, (v = new Map()));
      v.set(p.name, (v.get(p.name) ?? 0) + 1);
    }
  for (const info of byKey.values()) {
    info.trials = trials.get(info.key)?.size ?? 0;
    const v = variants.get(info.key);
    if (v) info.name = [...v.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return [...byKey.values()];
}

/** Distinct parents for the lens search: industry first (by trials), then the rest alphabetically. */
export function companyOptions(f: PipelineFile): string[] {
  const all = companyInfos(f);
  const industry = all.filter((c) => c.kind === "industry").sort((a, b) => b.trials - a.trials || a.name.localeCompare(b.name));
  const rest = all.filter((c) => c.kind !== "industry").sort((a, b) => a.name.localeCompare(b.name));
  return [...industry, ...rest].map((c) => c.name);
}

// ---------------------------------------------------------------- URL state

export function parseFigureState(p: URLSearchParams, f: PipelineFile | null): FigureState {
  const disease = p.get("disease");
  const sort = p.get("sort");
  const view = p.get("view");
  const company = p.get("company");
  const key = company === null ? "" : normKey(company);
  return {
    disease: f && disease !== null && f.diseases.some((d) => d.code === disease) ? disease : null,
    company: f && key ? (companyOptions(f).find((c) => normKey(c) === key) ?? null) : null,
    sort: SORTS.find((s) => s === sort) ?? "run",
    view: VIEWS.find((v) => v === view) ?? "phase",
  };
}

/** Query string (no leading "?") for a state; defaults are left out. */
export function figureSearch(s: FigureState): string {
  const q = new URLSearchParams();
  if (s.disease) q.set("disease", s.disease);
  if (s.company) q.set("company", s.company);
  if (s.sort !== "run") q.set("sort", s.sort);
  if (s.view !== "phase") q.set("view", s.view);
  return q.toString();
}

// ---------------------------------------------------------------- rows

export interface CompanyCount {
  parent: string;
  kind: SponsorKind;
  n: number;
  run: number;
}

export interface RowView {
  row: PipelineRow;
  marks: PipelineMark[];
  total: number;
  run: number;
  adv: number;
  stop: number;
  recent: number;
  /** Industry parents only, by marks desc. */
  companies: CompanyCount[];
  runningCompanies: number;
  /** Distinct non-industry parents. */
  academic: number;
  historical: boolean;
  hasCompany: boolean;
  /** The parent with most stopped marks in this row (for the margin note), if any stopped. */
  topStopper: { parent: string; n: number } | null;
}

function buildView(f: PipelineFile, r: PipelineRow, marks: PipelineMark[], s: FigureState, thisYear: number): RowView {
  const since = thisYear - NEWEST_YEARS + 1;
  const co = new Map<string, CompanyCount>();
  const academic = new Set<string>();
  const stoppers = new Map<string, { parent: string; n: number }>();
  const lens = s.company === null ? null : normKey(s.company);
  let run = 0;
  let adv = 0;
  let stop = 0;
  let recent = 0;
  let hasCompany = false;
  for (const m of marks) {
    const st = markState(m, s.disease);
    if (st === "run") run++;
    if (st === "adv") adv++;
    if (st === "stop") stop++;
    if (m.y !== null && m.y >= since) recent++;
    const p = parentOf(f, m);
    const key = normKey(p.name);
    if (lens !== null && key === lens) hasCompany = true;
    if (p.kind === "industry") {
      const c = co.get(key) ?? { parent: p.name, kind: p.kind, n: 0, run: 0 };
      c.n++;
      if (st === "run") c.run++;
      co.set(key, c);
    } else academic.add(key);
    if (st === "stop") {
      const t = stoppers.get(key) ?? { parent: p.name, n: 0 };
      t.n++;
      stoppers.set(key, t);
    }
  }
  const companies = [...co.values()].sort((a, b) => b.n - a.n || a.parent.localeCompare(b.parent));
  const topStopper = [...stoppers.values()].sort((a, b) => b.n - a.n || a.parent.localeCompare(b.parent))[0] ?? null;
  return {
    row: r,
    marks,
    total: marks.length,
    run,
    adv,
    stop,
    recent,
    companies,
    runningCompanies: companies.filter((c) => c.run > 0).length,
    academic: academic.size,
    historical: run <= HISTORICAL_MAX_RUNNING && marks.length >= HISTORICAL_MIN_TRIALS,
    hasCompany,
    topStopper,
  };
}

const COMPARE: Record<SortKey, (a: RowView, b: RowView) => number> = {
  run: (a, b) => b.run - a.run || b.adv - a.adv || a.row.label.localeCompare(b.row.label),
  adv: (a, b) => b.adv - a.adv || b.run - a.run || a.row.label.localeCompare(b.row.label),
  new: (a, b) => b.recent - a.recent || a.row.label.localeCompare(b.row.label),
  az: (a, b) => a.row.label.localeCompare(b.row.label),
};

/** One view per row that has marks under the disease filter, sorted, with the company's rows first. */
export function rowViews(f: PipelineFile, s: FigureState, thisYear: number): RowView[] {
  const views: RowView[] = [];
  for (const r of f.rows) {
    const marks = s.disease === null ? r.marks : r.marks.filter((m) => m.dz.includes(s.disease as string));
    if (marks.length) views.push(buildView(f, r, marks, s, thisYear));
  }
  views.sort(COMPARE[s.sort]);
  if (s.company === null) return views;
  return [...views.filter((v) => v.hasCompany), ...views.filter((v) => !v.hasCompany)];
}

/** A cell's marks, oldest first (undated last). The page draws each with markState(m, disease-or-column). */
export function cellMarks(v: RowView, column: number | string, s: FigureState): PipelineMark[] {
  const hit =
    s.view === "phase"
      ? v.marks.filter((m) => m.c === column)
      : v.marks.filter((m) => typeof column === "string" && m.dz.includes(column));
  return [...hit].sort((a, b) => (a.y ?? Infinity) - (b.y ?? Infinity));
}

// ---------------------------------------------------------------- headline

export interface Headline {
  kind: "field" | "lens" | "none";
  running: number;
  advanced: number;
  companiesRunning: number;
  trials: number;
  text: { lead: string; rest: string };
}

export function headline(f: PipelineFile, views: RowView[], s: FigureState): Headline {
  const lens = s.company === null ? null : normKey(s.company);
  const seen = new Set<string>();
  const running = new Set<string>();
  const advanced = new Set<string>();
  const companies = new Set<string>();
  for (const v of views)
    for (const m of v.marks) {
      const p = parentOf(f, m);
      const key = normKey(p.name);
      if (lens !== null && key !== lens) continue;
      seen.add(m.n);
      const st = markState(m, s.disease);
      if (st === "run") {
        running.add(m.n);
        if (p.kind === "industry") companies.add(key);
      }
      if (st === "adv") advanced.add(m.n);
    }
  const base = { running: running.size, advanced: advanced.size, companiesRunning: companies.size, trials: seen.size };
  const where = s.disease ? ` in ${s.disease}` : "";

  if (lens !== null) {
    if (seen.size === 0)
      return { kind: "none", ...base, text: { lead: `Nothing for ${s.company}`, rest: s.disease ? ` in ${s.disease}.` : "." } };
    const classes = views.filter((v) => v.hasCompany).length;
    return {
      kind: "lens",
      ...base,
      text: {
        lead: s.company as string,
        rest: `: ${n(seen.size)} ${plural(seen.size, "trial", "trials")} across ${classes} ${plural(classes, "target class", "target classes")}; ${n(running.size)} running, ${n(advanced.size)} advanced.`,
      },
    };
  }
  if (running.size === 0) {
    return {
      kind: "none",
      ...base,
      text: {
        lead: `No targeted-drug trials are running${where};`,
        rest: ` ${n(seen.size)} finished or stopped.`,
      },
    };
  }

  // The leading family: the most distinct running trials; ties go to the lower family order.
  const byFamily = new Map<string, Set<string>>();
  for (const v of views) {
    for (const m of v.marks)
      if (markState(m, s.disease) === "run") {
        const set = byFamily.get(v.row.family) ?? new Set<string>();
        set.add(m.n);
        byFamily.set(v.row.family, set);
      }
  }
  const order = (id: string): number => f.families.find((x) => x.id === id)?.order ?? Infinity;
  const [famId, famSet] = [...byFamily.entries()].sort((a, b) => b[1].size - a[1].size || order(a[0]) - order(b[0]))[0]!;
  const famLabel = f.families.find((x) => x.id === famId)?.label ?? famId;
  // The row with most running trials; the current sort order breaks ties (views are already sorted).
  const top = views.reduce((best, v) => (v.run > best.run ? v : best), views[0]!);
  return {
    kind: "field",
    ...base,
    text: {
      lead: `${n(running.size)} targeted-drug ${plural(running.size, "trial is", "trials are")} running${where}.`,
      rest: `${famLabel} leads, with ${n(famSet.size)} of them; ${top.row.label} alone has ${n(top.run)}.`,
    },
  };
}

// ---------------------------------------------------------------- margin notes

export interface MarginNote {
  kicker: string;
  text: string;
}

/** At most MAX_NOTES data-generated notes, one per row, none with the company lens (spec §7.1). */
export function marginNotes(
  views: RowView[],
  s: FigureState,
  thisYear: number,
  diseaseOrder: readonly string[] = [],
): Map<string, MarginNote> {
  const notes = new Map<string, MarginNote>();
  if (s.company !== null) return notes;
  const since = thisYear - NEWEST_YEARS + 1;

  const runningDiseases = (v: RowView): string[] => {
    const set = new Set<string>();
    for (const m of v.marks) if (markState(m, s.disease) === "run") m.dz.forEach((d) => set.add(d));
    const rank = (d: string): number => (diseaseOrder.includes(d) ? diseaseOrder.indexOf(d) : diseaseOrder.length);
    return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  };

  interface Rule {
    kicker: string;
    on: boolean;
    score: (v: RowView) => number;
    min: number;
    text: (v: RowView) => string;
  }
  const rules: Rule[] = [
    {
      kicker: "Spreading",
      on: s.view === "disease",
      score: (v) => runningDiseases(v).length,
      min: SPREADING_MIN,
      text: (v) => {
        const d = runningDiseases(v);
        return `Running in ${d.length} diseases: ${d.join(", ")}.`;
      },
    },
    {
      kicker: "Most crowded",
      on: true,
      score: (v) => v.run,
      min: MOST_CROWDED_MIN,
      text: (v) =>
        v.runningCompanies === 0
          ? `${n(v.run)} trials running, all from academic groups or other sponsors.`
          : `${n(v.run)} trials running, from ${v.runningCompanies} ${plural(v.runningCompanies, "company", "companies")} plus academic groups.`,
    },
    {
      kicker: "Newest wave",
      on: true,
      score: (v) => (v.total >= NEWEST_MIN_TRIALS && v.recent / v.total >= NEWEST_MIN_SHARE ? v.recent / v.total : 0),
      min: NEWEST_MIN_SHARE,
      text: (v) => `${n(v.recent)} of ${n(v.total)} trials started since ${since}.`,
    },
    {
      kicker: "Most advanced",
      on: true,
      score: (v) => v.adv,
      min: MOST_ADVANCED_MIN,
      text: (v) => `${n(v.adv)} trials advanced to a later phase.`,
    },
    {
      kicker: "Most stopped",
      on: true,
      score: (v) => v.stop,
      min: MOST_STOPPED_MIN,
      text: (v) => `${n(v.stop)} stopped; ${v.topStopper?.n ?? 0} of them by ${v.topStopper?.parent ?? "unnamed sponsors"}. Reasons on the target page.`,
    },
  ];

  for (const rule of rules) {
    if (!rule.on || notes.size >= MAX_NOTES) continue;
    let best: RowView | null = null;
    let bestScore = 0;
    for (const v of views) {
      if (notes.has(v.row.id)) continue;
      const sc = rule.score(v);
      if (sc >= rule.min && sc > bestScore) {
        best = v;
        bestScore = sc;
      }
    }
    if (best) notes.set(best.row.id, { kicker: rule.kicker, text: rule.text(best) });
  }
  return notes;
}

// ---------------------------------------------------------------- text

/** The figure's source line (spec §7.1) with its numbers filled. */
export function sourceLine(f: PipelineFile, views: RowView[]): string {
  const shown = new Set<string>();
  for (const v of views) for (const m of v.marks) shown.add(m.n);
  return (
    `${n(shown.size)} of ${n(f.counts.trials)} trials test a targeted drug in one of these ${views.length} classes; ` +
    `${n(f.counts.targeted_not_rowed)} more targeted-drug trials sit in smaller classes (Methods); ` +
    "the rest are care, cell transplant, plasma treatments and others (see all in Approaches). " +
    "ClinicalTrials.gov registered trials only: no preclinical programmes, company pipeline disclosures or EU-only trials."
  );
}

export const rowAccessibleName = (v: RowView): string =>
  `${v.row.label}: ${n(v.total)} trials, ${n(v.run)} running, ${n(v.adv)} advanced, ${n(v.stop)} stopped. Open target page.`;

// ---------------------------------------------------------------- target page

const STATE_RANK: Record<MarkState, number> = { adv: 0, run: 1, stop: 2, fin: 3, unk: 4 };
const byStateThenYear = (a: PipelineMark, b: PipelineMark): number =>
  STATE_RANK[a.s] - STATE_RANK[b.s] || (a.y ?? Infinity) - (b.y ?? Infinity);

/**
 * Maps each drug key to its root: a name that starts with another drug name in the same row plus a space
 * ("efgartigimod ph20" after "efgartigimod") is that drug. The shortest such root wins.
 */
export function drugRoots(marks: PipelineMark[]): { root: (key: string) => string; display: Map<string, string> } {
  const display = new Map<string, string>();
  for (const m of marks) if (!display.has(normKey(m.drug))) display.set(normKey(m.drug), m.drug);
  const keys = [...display.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const root = (key: string): string => keys.find((k) => k === key || key.startsWith(`${k} `)) ?? key;
  return { root, display };
}

/** One lane per drug with at least LANE_MIN_TRIALS trials, biggest first; the rest pooled last. */
export function drugLanes(marks: PipelineMark[], label: string): { name: string; marks: PipelineMark[] }[] {
  const { root, display } = drugRoots(marks);
  const groups = new Map<string, { name: string; marks: PipelineMark[] }>();
  for (const m of marks) {
    const key = root(normKey(m.drug));
    const g = groups.get(key) ?? { name: display.get(key) ?? m.drug, marks: [] };
    g.marks.push(m);
    groups.set(key, g);
  }
  const lanes = [...groups.values()].filter((g) => g.marks.length >= LANE_MIN_TRIALS);
  lanes.sort((a, b) => b.marks.length - a.marks.length || a.name.localeCompare(b.name));
  const rest = [...groups.values()].filter((g) => g.marks.length < LANE_MIN_TRIALS).flatMap((g) => g.marks);
  if (rest.length) lanes.push({ name: `Other ${label}`, marks: rest });
  return lanes;
}

/** Industry parents by trial count, then one "Academic and other" line. Marks: advanced, running, stopped, finished. */
export function targetCompanies(
  f: PipelineFile,
  marks: PipelineMark[],
): { parent: string; drugs: string[]; marks: PipelineMark[]; run: number }[] {
  interface G {
    parent: string;
    marks: PipelineMark[];
  }
  const industry = new Map<string, G>();
  const other: G = { parent: "Academic and other", marks: [] };
  for (const m of marks) {
    const p = parentOf(f, m);
    if (p.kind !== "industry") {
      other.marks.push(m);
      continue;
    }
    const key = normKey(p.name);
    const g = industry.get(key) ?? { parent: p.name, marks: [] };
    g.marks.push(m);
    industry.set(key, g);
  }
  const { root, display } = drugRoots(marks);
  const finish = (g: G) => {
    const sorted = [...g.marks].sort(byStateThenYear);
    const drugCount = new Map<string, number>();
    for (const m of sorted) {
      const name = display.get(root(normKey(m.drug))) ?? m.drug;
      drugCount.set(name, (drugCount.get(name) ?? 0) + 1);
    }
    const drugs = [...drugCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
    return { parent: g.parent, drugs, marks: sorted, run: sorted.filter((m) => m.s === "run").length };
  };
  const list = [...industry.values()]
    .sort((a, b) => b.marks.length - a.marks.length || a.parent.localeCompare(b.parent))
    .map(finish);
  if (other.marks.length) list.push(finish(other));
  return list;
}

/** Reason groups with counts, whether to show them, and the stopped trials (newest first). */
export function stopSummary(
  f: PipelineFile,
  marks: PipelineMark[],
): { groups: [string, number][]; showGroups: boolean; stops: PipelineMark[] } {
  const stops = marks.filter((m) => m.s === "stop").sort((a, b) => (b.y ?? -Infinity) - (a.y ?? -Infinity) || a.n.localeCompare(b.n));
  const counts = new Map<string, number>();
  for (const m of stops) {
    const r = f.trials[m.n]?.r;
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const given = groups.filter(([g]) => g !== "Not given").reduce((t, [, k]) => t + k, 0);
  const other = counts.get("Other") ?? 0;
  return { groups, showGroups: given === 0 || other / given <= OTHER_MAX_SHARE, stops };
}

// ---------------------------------------------------------------- hand-offs

/** The row a gene belongs to (the first in figure order when several share it, e.g. CD19 and CD19 CAR-T); null if none. */
export function rowForGene(f: PipelineFile, gene: string): PipelineRow | null {
  return f.rows.find((r) => r.gene === gene) ?? null; // f.rows is already in figure order
}

/** Every row the trial sits in, in figure order (a combination trial can sit in two). */
export function rowsForTrial(f: PipelineFile, nct: string): PipelineRow[] {
  return f.rows.filter((r) => r.marks.some((m) => m.n === nct));
}
