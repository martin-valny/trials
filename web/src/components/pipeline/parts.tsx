import { Fragment } from "react";
import { COMPANIES_ON_ROW, figureSearch, type FigureState, type RowView, type YearBin } from "../../lib/pipeline";
import type { PipelineFile, PipelineMark } from "../../types";

const PHASE_COLS = [
  { key: 1, label: "Phase 1", short: "Ph 1", sub: "incl. early phase 1" },
  { key: 2, label: "Phase 2", short: "Ph 2", sub: "incl. 1/2" },
  { key: 3, label: "Phase 3", short: "Ph 3", sub: "incl. 2/3" },
  { key: 4, label: "Approved use", short: "Approved", sub: "phase 4" },
];
/** A long code shortens to its first three letters on a phone (NMOSD reads NMO). */
const phoneCode = (code: string): string => (code.length > 4 ? code.slice(0, 3) : code);

export interface Col {
  key: number | string;
  label: string;
  short: string;
  sub: string;
  /** By year: this bin carries a label (every fifth year, and the first bin). */
  tick?: string;
}

/** The figure's columns: four phases, or the diseases in the order pipeline.json lists them. */
export function columnsFor(f: PipelineFile, view: FigureState["view"], bins: YearBin[] = []): Col[] {
  if (view === "phase") return PHASE_COLS;
  if (view === "year") {
    const width = bins.length > 1 ? bins[1]!.start - bins[0]!.start : 2;
    // The first bin keeps its "≤" label; any other bin that contains a multiple of 5 is labelled with it.
    return bins.map((b, i) => {
      const m = Math.ceil(b.start / 5) * 5;
      const tick = i === 0 ? b.label : m < b.start + width ? String(m) : undefined;
      return { key: i, label: b.label, short: tick ?? "", sub: "", ...(tick ? { tick } : {}) };
    });
  }
  return f.diseases.map((d) => ({ key: d.code, label: d.code, short: phoneCode(d.code), sub: d.label === d.code ? "" : d.label }));
}

const WEIGHT_MAX = 2.2;
const WEIGHT_MIN = 0.7;

/**
 * CSS grid tracks for the figure's columns. By phase they are equal; By disease they are weighted by
 * the square root of each disease's trial count (with a floor), so a crowded column gets room and a
 * near-empty one stays readable. Undefined means the stylesheet's equal columns.
 */
export function columnTracks(f: PipelineFile, cols: Col[], view: FigureState["view"]): string | undefined {
  if (view !== "disease") return undefined;
  const count = new Map<string, number>();
  for (const r of f.rows) for (const m of r.marks) for (const d of m.dz) count.set(d, (count.get(d) ?? 0) + 1);
  const top = Math.max(1, ...cols.map((c) => count.get(String(c.key)) ?? 0));
  return cols
    .map((c) => `minmax(0, ${Math.max(WEIGHT_MIN, WEIGHT_MAX * Math.sqrt((count.get(String(c.key)) ?? 0) / top)).toFixed(2)}fr)`)
    .join(" ");
}

export type Item = { t: "fam"; label: string } | { t: "past" } | { t: "row"; v: RowView; hist: boolean };

/** Rows in drawing order: family bands (when the sort groups them), then the "mostly historical" tail. */
export function layout(f: PipelineFile, views: RowView[], s: FigureState): Item[] {
  const live = views.filter((v) => !v.historical);
  const hist = views.filter((v) => v.historical);
  const flat = s.sort === "az" || s.company !== null;
  const items: Item[] = [];
  if (flat) live.forEach((v) => items.push({ t: "row", v, hist: false }));
  else {
    const fams: string[] = [];
    live.forEach((v) => fams.includes(v.row.family) || fams.push(v.row.family));
    for (const id of fams) {
      items.push({ t: "fam", label: f.families.find((x) => x.id === id)?.label ?? id });
      live.filter((v) => v.row.family === id).forEach((v) => items.push({ t: "row", v, hist: false }));
    }
  }
  if (hist.length) {
    items.push({ t: "past" });
    hist.forEach((v) => items.push({ t: "row", v, hist: true }));
  }
  return items;
}

export type MarkSize = 8 | 6 | 4 | 3.5;

export interface Draw {
  state: FigureState;
  file: PipelineFile;
  /** The company lens, normalised, or null. */
  lens: string | null;
  mark: (m: PipelineMark, rowId: string, col: number | string, size?: MarkSize) => React.ReactNode;
  onCompany: (name: string) => void;
}

export function RowCompanies({ v, draw }: { v: RowView; draw: Draw }) {
  const top = v.companies.slice(0, COMPANIES_ON_ROW);
  const more = v.companies.length - top.length;
  if (!top.length) return <span className="more">academic sponsors only</span>;
  return (
    <>
      {top.map((c, i) => (
        <Fragment key={c.parent}>
          {i > 0 && " · "}
          <button type="button" className="co-link" onClick={() => draw.onCompany(c.parent)}>
            {c.parent}
          </button>
        </Fragment>
      ))}
      {more > 0 && <span className="more"> +{more}</span>}
      {v.academic > 0 && <span className="more"> · {v.academic} academic</span>}
    </>
  );
}

export function rowHref(v: RowView, s: FigureState): string {
  return `/target/${v.row.id}${s.disease ? `?${figureSearch({ ...s, company: null, sort: "run", view: "phase" })}` : ""}`;
}

