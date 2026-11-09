// Stop-risk estimates (risk.json): number formatting, the comparison with the typical rate, the
// watch list's ranking and filtering, and target roll-ups. Pure functions over RiskFile.
import type { PipelineFile, RiskFile, RiskTargetSummary, TrialsIndex } from "../types";

/** Top of the scale the estimate is drawn on. */
export const scaleMax = 0.6;
/** Within this of the typical rate counts as "near" it. */
const NEAR = 0.03;

export const formatPct = (p: number): string => (p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

export const formatRange = (lo: number, hi: number): string => `${Math.round(lo * 100)}–${Math.round(hi * 100)}`;

export function vsTypical(p: number, typical: number): "above" | "near" | "below" {
  const d = p - typical;
  // A small epsilon keeps a difference of exactly 0.03 "near" despite float error.
  if (Math.abs(d) <= NEAR + 1e-9) return "near";
  return d > 0 ? "above" : "below";
}

/** Position on the 0..scaleMax scale as 0..1, clamped. */
export const scalePos = (p: number): number => Math.min(1, Math.max(0, p / scaleMax));

export interface WatchRow {
  nct: string;
  p: number;
  lo: number;
  hi: number;
  typical: number;
  basis: string;
  factors: { dir: "up" | "down"; label: string }[];
  /** Pipeline row id; null when the trial is in no row. */
  target: string | null;
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
  target: string;
  diseases: string[];
  company: string;
}

/** Where each trial sits in the pipeline figure: its first row, the mark's diseases and sponsor parent. */
function placements(pipeline: PipelineFile | null): Map<string, Placement> {
  const out = new Map<string, Placement>();
  if (!pipeline) return out;
  for (const row of pipeline.rows) {
    for (const m of row.marks) {
      if (out.has(m.n)) continue;
      out.set(m.n, {
        target: row.id,
        diseases: [...(m.dz ?? [])],
        company: pipeline.sponsors[m.sp]?.parent ?? "",
      });
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
      p: t.p,
      lo: t.lo,
      hi: t.hi,
      typical: t.typical,
      basis: t.basis,
      factors: t.factors,
      target: pl?.target ?? null,
      diseases: pl?.diseases ?? [],
      company: (pl ? pl.company : summary?.lead_sponsor) || null,
      phase: phaseLabel(summary?.phases ?? []),
      title: summary?.title ?? "",
    };
  });
  const keep = (r: WatchRow): boolean =>
    (!filter.disease?.length || r.diseases.some((d) => filter.disease?.includes(d))) &&
    (!filter.company?.length || (r.company !== null && filter.company.includes(r.company))) &&
    (!filter.target?.length || filter.target.includes(r.target ?? "none"));
  const key = (r: WatchRow): number => (sort === "estimate" ? r.p : r.p - r.typical);
  return rows.filter(keep).sort((a, b) => key(b) - key(a) || a.nct.localeCompare(b.nct));
}

/** A target's median estimate and typical rate, overall or within one disease; null when not scored. */
export function targetSummary(file: RiskFile, rowId: string, disease?: string): RiskTargetSummary | null {
  const t = file.targets?.[rowId];
  if (!t) return null;
  return (disease === undefined ? t.all : t.by_disease[disease]) ?? null;
}
