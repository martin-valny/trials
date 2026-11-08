import { Fragment } from "react";
import { COMPANIES_ON_ROW, figureSearch, type FigureState, type RowView } from "../../lib/pipeline";
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
}

/** The figure's columns: four phases, or the diseases in the order pipeline.json lists them. */
export function columnsFor(f: PipelineFile, view: FigureState["view"]): Col[] {
  if (view === "phase") return PHASE_COLS;
  return f.diseases.map((d) => ({ key: d.code, label: d.code, short: phoneCode(d.code), sub: d.label === d.code ? "" : d.label }));
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

export interface Draw {
  state: FigureState;
  file: PipelineFile;
  /** The company lens, normalised, or null. */
  lens: string | null;
  mark: (m: PipelineMark, rowId: string, col: number | string, size?: 6 | 8) => React.ReactNode;
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

