import { useState } from "react";
import type { MarginNote } from "../../lib/pipeline";
import { cellMarks, rowAccessibleName, type YearBin } from "../../lib/pipeline";
import { Link } from "react-router-dom";
import type { PipelineMark } from "../../types";
import { cellApproval, Floor, RowCompanies, rowHref, type Col, type Draw, type Item } from "./parts";

interface Props {
  items: Item[];
  cols: Col[];
  tracks?: string | undefined;
  bins?: YearBin[] | undefined;
  /** Where the data snapshot falls across the year bins, 0 to 1. */
  asOf?: number | undefined;
  sortCell: (marks: PipelineMark[]) => PipelineMark[];
  notes: Map<string, MarginNote>;
  draw: Draw;
}

/** The phone arrangement (<= 640px): a sticky column header, then each row as label plus a strip of cells. */
export function PipelineStrip({ items: all, cols, tracks, bins, asOf, sortCell, notes, draw }: Props) {
  // With a company lens a phone shows only the rows the company is in; the rest sit behind a toggle
  // (the desktop figure fades them to 45% instead; faded rows are unreadable at this size).
  const [others, setOthers] = useState(false);
  const missing = (it: Item): boolean => it.t === "row" && !it.v.hasCompany;
  const hide = draw.lens !== null && !others;
  const kept = hide ? all.filter((it) => !missing(it)) : all;
  const items = kept.filter((it, i) => it.t !== "past" || kept.slice(i + 1).some((x) => x.t === "row"));
  const hidden = draw.lens !== null ? all.filter(missing).length : 0;
  const year = draw.state.view === "year";
  const style = { "--n": cols.length, ...(tracks ? { "--cols": tracks } : {}), ...(asOf !== undefined ? { "--asof": asOf } : {}) } as React.CSSProperties;
  return (
    <div className={`pstrip${year ? " by-year" : ""}`} style={style}>
      {year && <i className="asof" aria-hidden="true" />}
      <div className="pcol" aria-hidden="true">
        {cols.map((c) => (
          <span key={c.key}>{c.short}</span>
        ))}
      </div>
      {items.map((it, i) => {
        if (it.t === "fam") return <div key={"f" + it.label} className="pfam">{it.label}</div>;
        if (it.t === "past") return <div key="past" className="past">Mostly historical</div>;
        const { v } = it;
        const note = notes.get(v.row.id);
        const miss = draw.lens !== null && !v.hasCompany;
        return (
          <div key={v.row.id + i} className={`prow${it.hist ? " hist" : ""}${miss ? " miss" : ""}`} data-row={v.row.id}>
            <Link className="row-link" to={rowHref(v, draw.state)} aria-label={rowAccessibleName(v)} />
            <div className="top">
              <b>{v.row.label}</b>
              <span className="sub">{v.row.sub.split(" · ")[0]}</span>
              <span className="rn">
                <b>{v.run}</b> running
              </span>
            </div>
            <div className="strip">
              {cols.map((c) => {
                const ap = cellApproval(draw.file, draw.state, v, c.key);
                return (
                  <div key={c.key} className={`cell${ap ? " ap" : ""}`} data-cell={c.key} title={ap ?? undefined}>
                    {sortCell(cellMarks(v, c.key, draw.state, bins)).map((m) => draw.mark(m, v.row.id, c.key, 6))}
                    {ap && <Floor text={ap} />}
                  </div>
                );
              })}
            </div>
            <div className="cos">
              <RowCompanies v={v} draw={draw} />
            </div>
            {note && (
              <div className="pn">
                <b>{note.kicker}</b>
                {note.text}
              </div>
            )}
          </div>
        );
      })}
      {hidden > 0 && (
        <button type="button" className="other-rows" aria-expanded={others} onClick={() => setOthers((o) => !o)}>
          {others ? "Hide the other rows" : `Show ${hidden} other ${hidden === 1 ? "row" : "rows"}`}
        </button>
      )}
    </div>
  );
}
