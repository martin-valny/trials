// Stop-risk estimates (risk.json): number formatting, the comparison with the typical rate, the
// watch list's ranking and filtering, and target roll-ups. Pure functions over RiskFile.
import type { PipelineFile, RiskFile, RiskTargetSummary, TrialsIndex } from "../types";

/** Top of the scale the estimate is drawn on. */
export const scaleMax = 0.6;
/** Within this of the typical rate counts as "near" it. */
const NEAR = 0.03;

export const formatPct = (p: number): string => (p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

/** One end of a range: anything under 0.5%, exactly 0 included, is "<1", so a range never reads as certainty. */
const rangeEnd = (x: number): string => (x < 0.005 ? "<1" : `${Math.round(x * 100)}`);

export const formatRange = (lo: number, hi: number): string => `${rangeEnd(lo)}–${rangeEnd(hi)}`;

/** "near" when within ±0.03 of typical, or when the range [lo, hi] (if given) contains the typical rate. */
export function vsTypical(p: number, typical: number, lo?: number, hi?: number): "above" | "near" | "below" {
  if (lo !== undefined && hi !== undefined && lo <= typical && typical <= hi) return "near";
  const d = p - typical;
  // A small epsilon keeps a difference of exactly 0.03 "near" despite float error.
  if (Math.abs(d) <= NEAR + 1e-9) return "near";
  return d > 0 ? "above" : "below";
}

/** How many estimates sit above their typical rate ("above" by vsTypical, range included). */
export function countAbove(rows: readonly { p: number; lo: number; hi: number; typical: number }[]): number {
  return rows.filter((r) => vsTypical(r.p, r.typical, r.lo, r.hi) === "above").length;
}

/** The claim line: "2 of 7 sit above …", or with a target "2 of 7 running CD20 trials sit above …". */
export function aboveLine(k: number, n: number, target?: string): string {
  const of = target ? `${k} of ${n} running ${target} ${n === 1 ? "trial" : "trials"}` : `${k} of ${n}`;
  return `${of} ${k === 1 ? "sits" : "sit"} above their phase's typical rate.`;
}

/** Position on the 0..scaleMax scale as 0..1, clamped. */
export const scalePos = (p: number): number => Math.min(1, Math.max(0, p / scaleMax));

export interface WatchRow {
  nct: string;
  /** risk.json's display name, else the trial's first pipeline mark's drug; null when neither. */
  drug: string | null;
  p: number;
  lo: number;
  hi: number;
  typical: number;
  basis: string;
  factors: { dir: "up" | "down"; label: string }[];
  /** Primary (first) pipeline row id, for display; null when the trial is in no row. */
  target: string | null;
  /** Every pipeline row the trial is in, in row order. */
  targets: string[];
  diseases: string[];
  company: string | null;
  phase: string;
  title: string;
}

export interface WatchFilter {
  disease?: string[];
  company?: string[];
  /** Row ids; the special value "none" matches trials in no row. */
  target?: string[];
}

export type WatchSort = "estimate" | "difference";

/** "PHASE1","PHASE2" -> "Phase 1/2"; a single phase -> "Phase 2"; none -> "". */
function phaseLabel(phases: readonly string[]): string {
  const nums = phases.map((p) => /^PHASE(\d)$/.exec(p)?.[1]).filter((x): x is string => x !== undefined);
  return nums.length === 0 ? "" : `Phase ${nums.join("/")}`;
}

interface Placement {
  drug: string;
  targets: string[];
  diseases: string[];
  company: string;
}

/** Where each trial sits in the pipeline figure: every row it is in (in row order), the union of its
 *  marks' diseases, and the first mark's sponsor parent. Matches the pipeline's own roll-up. */
function placements(pipeline: PipelineFile | null): Map<string, Placement> {
  const out = new Map<string, Placement>();
  if (!pipeline) return out;
  for (const row of pipeline.rows) {
    for (const m of row.marks) {
      let pl = out.get(m.n);
      if (!pl) {
        pl = { drug: m.drug, targets: [], diseases: [], company: pipeline.sponsors[m.sp]?.parent ?? "" };
        out.set(m.n, pl);
      }
      if (!pl.targets.includes(row.id)) pl.targets.push(row.id);
      for (const d of m.dz ?? []) if (!pl.diseases.includes(d)) pl.diseases.push(d);
    }
  }
  return out;
}

export function rankTrials(
  file: RiskFile,
  filter: WatchFilter,
  sort: WatchSort,
  pipeline: PipelineFile | null,
  index: TrialsIndex | null,
): WatchRow[] {
  if (!file.trials) return [];
  const place = placements(pipeline);
  const info = new Map((index?.trials ?? []).map((t) => [t.nct_id, t]));
  const rows: WatchRow[] = Object.entries(file.trials).map(([nct, t]) => {
    const pl = place.get(nct);
    const summary = info.get(nct);
    return {
      nct,
      drug: t.drug ?? pl?.drug ?? null,
      p: t.p,
      lo: t.lo,
      hi: t.hi,
      typical: t.typical,
      basis: t.basis,
      factors: t.factors,
      target: pl?.targets[0] ?? null,
      targets: pl?.targets ?? [],
      diseases: pl?.diseases ?? [],
      company: (pl?.company || summary?.lead_sponsor) || null,
      phase: phaseLabel(summary?.phases ?? []),
      title: summary?.title ?? "",
    };
  });
  const keep = (r: WatchRow): boolean =>
    (!filter.disease?.length || r.diseases.some((d) => filter.disease?.includes(d))) &&
    (!filter.company?.length || (r.company !== null && filter.company.includes(r.company))) &&
    (!filter.target?.length || (r.targets.length === 0 ? filter.target.includes("none") : r.targets.some((t) => filter.target?.includes(t))));
  const key = (r: WatchRow): number => (sort === "estimate" ? r.p : r.p - r.typical);
  return rows.filter(keep).sort((a, b) => key(b) - key(a) || a.nct.localeCompare(b.nct));
}

/** A target's median estimate and typical rate, overall or within one disease; null when not scored. */
/** Without per-trial scores, the pipeline leaves out summaries of fewer trials (they would give away single estimates); the web holds the same line. */
export const MIN_SUMMARY_N = 3;

export function targetSummary(file: RiskFile, rowId: string, disease?: string): RiskTargetSummary | null {
  const t = file.targets?.[rowId];
  if (!t) return null;
  return (disease === undefined ? t.all : t.by_disease[disease]) ?? null;
}
