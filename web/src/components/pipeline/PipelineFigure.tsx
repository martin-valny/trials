import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  cellMarks,
  MARK_LABEL,
  markState,
  normKey,
  rowAccessibleName,
  type FigureState,
  type MarginNote,
  type RowView,
} from "../../lib/pipeline";
import type { MarkState, PipelineFile, PipelineMark } from "../../types";
import { Mark } from "./Mark";
import { columnsFor, layout, RowCompanies, rowHref, type Draw } from "./parts";
import { PipelineStrip } from "./PipelineStrip";
import { phaseText, TrialCard } from "./TrialCard";

interface Props {
  file: PipelineFile;
  views: RowView[];
  state: FigureState;
  notes: Map<string, MarginNote>;
  phone: boolean;
  onCompany: (name: string) => void;
}

interface Tip {
  x: number;
  y: number;
  head: string;
  sub?: string;
  body?: string;
}
interface Open {
  nct: string;
  rowId: string;
  disease: string | null;
  x: number;
  y: number;
  flip: boolean;
}

export function PipelineFigure({ file, views, state, notes, phone, onCompany }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const lens = state.company === null ? null : normKey(state.company);
  const cols = columnsFor(file, state.view);
  const items = layout(file, views, state);
  const maxRun = Math.max(1, ...views.map((v) => v.run));

  const at = (el: Element) => {
    const b = box.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { r, x: r.left - b.left, y: r.bottom - b.top, w: b.width };
  };
  const show = (el: Element, t: Omit<Tip, "x" | "y">) => {
    if (!box.current) return;
    const p = at(el);
    setTip({ ...t, x: Math.max(0, Math.min(p.x - 4, p.w - 290)), y: p.y + 8 });
  };
  const close = useCallback(() => setOpen(null), []);

  const mark = (m: PipelineMark, rowId: string, col: number | string, size: 6 | 8 = 8) => {
    const disease = state.view === "disease" ? String(col) : state.disease;
    const st: MarkState = markState(m, disease);
    const sp = file.sponsors[m.sp];
    const hit = lens !== null && sp !== undefined && normKey(sp.parent) === lens;
    return (
      <Mark
        key={m.n + col}
        m={m}
        state={st}
        hit={hit}
        size={size}
        onEnter={(e) =>
          show(e.currentTarget, {
            head: file.trials[m.n]?.t ?? m.n,
            sub: `${m.drug} · ${sp?.parent ?? "Unknown sponsor"}`,
            body: `${m.n} · ${phaseText(m)} · ${m.y === null ? "start not given" : `started ${m.y}`} · ${m.via ? `Advanced, through ${m.via}` : MARK_LABEL[st]}`,
          })
        }
        onLeave={() => setTip(null)}
        onClick={(e) => {
          e.stopPropagation();
          setTip(null);
          const p = at(e.currentTarget);
          const flip = p.r.bottom + 300 > window.innerHeight;
          setOpen({ nct: m.n, rowId, disease, x: Math.max(0, Math.min(p.x - 8, p.w - 340)), y: flip ? p.r.top - box.current!.getBoundingClientRect().top - 8 : p.y + 8, flip });
        }}
      />
    );
  };
  const draw: Draw = { state, file, lens, mark, onCompany };

  return (
    <div className={`fig${lens ? " lensed" : ""}`} ref={box}>
      {phone ? (
        <PipelineStrip items={items} cols={cols} notes={notes} draw={draw} />
      ) : (
        <div className="grid" style={{ "--n": cols.length } as React.CSSProperties}>
          <div className="grid-head">
            <div className="colhead first">Target</div>
            {cols.map((c) => (
              <div key={c.key} className="colhead" data-col={c.key}>
                {c.label}
                {c.sub && <small>{c.sub}</small>}
              </div>
            ))}
            <div className="colhead">Running</div>
            <div className="colhead" />
          </div>
          {items.map((it, i) => {
            if (it.t === "fam") return <div key={"f" + it.label} className="fam">{it.label}</div>;
            if (it.t === "past")
              return (
                <div key="past" className="past">
                  Mostly historical <em>— many past trials, at most one running</em>
                </div>
              );
            const { v } = it;
            const note = notes.get(v.row.id);
            const miss = lens !== null && !v.hasCompany;
            return (
              <div key={v.row.id + i} className={`row${it.hist ? " hist" : ""}${miss ? " miss" : ""}`} data-row={v.row.id}>
                <Link className="row-link" to={rowHref(v, state)} aria-label={rowAccessibleName(v)} />
                <div className="lab">
                  <b>{v.row.label}</b>
                  <span className="sub">{v.row.sub}</span>
                  <div className="cos">
                    <RowCompanies v={v} draw={draw} />
                  </div>
                </div>
                {cols.map((c) => {
                  const ms = cellMarks(v, c.key, state);
                  return (
                    <div key={c.key} className="cell" data-cell={c.key}>
                      {ms.map((m) => mark(m, v.row.id, c.key))}
                      {ms.length === 0 && state.view === "disease" && (
                        <span
                          className="nodot"
                          data-empty=""
                          onMouseEnter={(e) => show(e.currentTarget, { head: `No registered trial of ${v.row.label} in ${c.label}` })}
                          onMouseLeave={() => setTip(null)}
                        />
                      )}
                    </div>
                  );
                })}
                <div className="stat">
                  <b>{v.run}</b> of {v.total}
                  <div className="bar">
                    <i style={{ width: `${(v.run / maxRun) * 100}%` }} />
                  </div>
                  {v.runningCompanies} {v.runningCompanies === 1 ? "company" : "companies"}
                </div>
                <div className={note ? "note" : "note-empty"}>
                  {note && (
                    <>
                      <span className="nk">{note.kicker}</span>
                      {note.text}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tip && (
        <div className="tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.head}</b>
          {tip.sub && <span>{tip.sub}</span>}
          {tip.body && <span>{tip.body}</span>}
        </div>
      )}
      {open && (
        <TrialCard
          nct={open.nct}
          file={file}
          rowId={open.rowId}
          disease={open.disease}
          onClose={close}
          variant={phone ? "sheet" : "popover"}
          style={phone ? undefined : { left: open.x, top: open.y, transform: open.flip ? "translateY(-100%)" : undefined }}
        />
      )}
    </div>
  );
}
