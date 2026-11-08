import type { MarginNote } from "../../lib/pipeline";
import { cellMarks, rowAccessibleName } from "../../lib/pipeline";
import { Link } from "react-router-dom";
import { RowCompanies, rowHref, type Col, type Draw, type Item } from "./parts";

interface Props {
  items: Item[];
  cols: Col[];
  notes: Map<string, MarginNote>;
  draw: Draw;
}

/** The phone arrangement (<= 640px): a sticky column header, then each row as label plus a strip of cells. */
export function PipelineStrip({ items, cols, notes, draw }: Props) {
  const style = { "--n": cols.length } as React.CSSProperties;
  return (
    <div className="pstrip" style={style}>
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
              {cols.map((c) => (
                <div key={c.key} className="cell" data-cell={c.key}>
                  {cellMarks(v, c.key, draw.state).map((m) => draw.mark(m, v.row.id, c.key, 6))}
                </div>
              ))}
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
    </div>
  );
}
