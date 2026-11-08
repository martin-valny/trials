import { useEffect, useMemo, useRef, useState } from "react";
import { drugLanes, MARK_LABEL, markState } from "../../lib/pipeline";
import type { MarkState, PipelineFile, PipelineMark } from "../../types";
import { Mark } from "../pipeline/Mark";
import { phaseText } from "../pipeline/TrialCard";

interface Props {
  file: PipelineFile;
  label: string;
  marks: PipelineMark[];
  disease: string | null;
  onOpen: (nct: string, el: Element) => void;
}

const Y0 = 2000;
const Y_CAP = 2032;
/** The drawn width of a year-long span's last year (a trial ending in 2026 runs to the end of 2026). */
const END_PAD = 0.6;
const NARROW = 560;
const COLOR: Record<MarkState, string> = { adv: "var(--red)", run: "var(--run)", stop: "var(--stop)", fin: "var(--fin)", unk: "var(--unk)" };

/** Year with a fraction for the day of the year; the data-as-of rule sits here. */
function yearFraction(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return new Date().getFullYear() + 0.85;
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return d.getUTCFullYear() + (d.getTime() - start) / (365 * 864e5);
}

export function asOfText(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The width of an element, 1200 where it cannot be measured (tests, first paint). */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => el.clientWidth > 0 && setW(el.clientWidth));
    ro.observe(el);
    if (el.clientWidth > 0) setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

interface Placed {
  m: PipelineMark;
  track: number;
  s: number;
  e: number;
}

/** Pack a lane's dated trials into the fewest tracks, oldest first. */
function pack(marks: PipelineMark[]): { placed: Placed[]; tracks: number } {
  const ends: number[] = [];
  const placed: Placed[] = [];
  const dated = marks.filter((m) => m.y !== null).sort((a, b) => a.y! - b.y! || (a.y2 ?? 0) - (b.y2 ?? 0) || a.n.localeCompare(b.n));
  for (const m of dated) {
    const s = m.y!;
    const e = Math.max(m.y2 ?? s, s) + END_PAD;
    let k = ends.findIndex((t) => t <= s);
    if (k < 0) {
      k = ends.length;
      ends.push(0);
    }
    ends[k] = e + 0.15;
    placed.push({ m, track: k, s, e });
  }
  return { placed, tracks: ends.length };
}

export function TargetTimeline({ file, label, marks, disease, onOpen }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const narrow = width < NARROW;
  const [tip, setTip] = useState<{ x: number; y: number; m: PipelineMark } | null>(null);
  const [list, setList] = useState(false);
  const asof = yearFraction(file.generated_for);

  const lanes = useMemo(() => drugLanes(marks, label), [marks, label]);
  const y1 = useMemo(() => {
    let end = Math.ceil(asof);
    for (const m of marks) if (m.y !== null && m.est && m.y2 !== null) end = Math.max(end, m.y2);
    return Math.min(Y_CAP, end + 1);
  }, [marks, asof]);
  const undated = marks.filter((m) => m.y === null).length;

  const L = narrow ? 0 : 150;
  const R = 12;
  const W = width;
  const X = (y: number) => L + ((Math.min(Math.max(y, Y0), y1) - Y0) / (y1 - Y0)) * (W - L - R);
  const th = narrow ? 5 : 7;
  const dot = narrow ? 2.4 : 3;

  const laid: { name: string; marks: PipelineMark[]; placed: Placed[]; y: number; h: number }[] = [];
  let y = 26;
  for (const lane of lanes) {
    const { placed, tracks } = pack(lane.marks);
    const h = Math.max(tracks * th + 10, narrow ? 12 : 36);
    laid.push({ ...lane, placed, y: y + (narrow ? 10 : 0), h });
    y += h + (narrow ? 24 : 18);
  }
  const bottom = y;
  const H = bottom + 22;
  const nowX = X(asof);
  const ticks: number[] = [];
  for (let t = Y0; t <= y1; t += 5) ticks.push(t);

  const hover = (m: PipelineMark) => (e: React.MouseEvent) => {
    const b = box.current!.getBoundingClientRect();
    setTip({ x: Math.max(0, Math.min(e.clientX - b.left + 12, b.width - 290)), y: e.clientY - b.top + 14, m });
  };
  const st = (m: PipelineMark) => markState(m, disease);

  return (
    <div className="tline-wrap">
      <div className="tline" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Timeline of ${marks.length - undated} ${label} trials by drug. The list below has every trial.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={18} y2={bottom - 6} stroke="var(--rule)" />
              <text x={X(t)} y={11} fontSize="10.5" fill="var(--muted)" textAnchor="middle">
                {t}
              </text>
            </g>
          ))}
          {laid.map((lane) => (
            <g key={lane.name}>
              {narrow ? (
                <text x={0} y={lane.y - 6} fontSize="11.5" fontWeight="700" fill="var(--ink)">
                  {lane.name} <tspan fontWeight="400" fill="var(--muted)">{lane.marks.length}</tspan>
                </text>
              ) : (
                <>
                  <text x={0} y={lane.y + 12} fontSize="12.5" fontWeight="700" fill="var(--ink)">
                    {lane.name}
                  </text>
                  <text x={0} y={lane.y + 27} fontSize="11" fill="var(--muted)">
                    {lane.marks.length} {lane.marks.length === 1 ? "trial" : "trials"} · {lane.marks.filter((m) => st(m) === "run").length} running
                  </text>
                </>
              )}
              {lane.placed.map(({ m, track, s, e }) => {
                const state = st(m);
                const yy = lane.y + track * th + 4;
                const x1 = X(s);
                const x2 = X(e);
                const sw = narrow ? 2.4 : m.c >= 3 ? 3.6 : m.c === 2 ? 2.6 : 1.8;
                const c = COLOR[state];
                return (
                  <g key={m.n}>
                    {state === "run" ? (
                      <>
                        <line x1={x1} x2={Math.min(x2, nowX)} y1={yy} y2={yy} stroke={c} strokeWidth={sw} strokeLinecap="round" />
                        {x2 > nowX && <line x1={nowX} x2={x2} y1={yy} y2={yy} stroke={c} strokeWidth={sw * 0.6} strokeDasharray="2 2.5" />}
                        <circle cx={x1} cy={yy} r={dot} fill="var(--plate)" stroke={c} strokeWidth={1.4} />
                      </>
                    ) : (
                      <>
                        <line x1={x1} x2={x2} y1={yy} y2={yy} stroke={c} strokeWidth={sw} strokeLinecap="round" strokeDasharray={state === "unk" ? "2 2" : undefined} />
                        {state === "adv" && <circle cx={x2} cy={yy} r={dot} fill={c} />}
                        {state === "stop" && <line x1={x2} x2={x2} y1={yy - 3.5} y2={yy + 3.5} stroke={c} strokeWidth={1.6} />}
                      </>
                    )}
                    <line
                      data-n={m.n}
                      className="tl-hit"
                      x1={x1 - 2}
                      x2={Math.max(x2, x1 + 6)}
                      y1={yy}
                      y2={yy}
                      stroke="transparent"
                      strokeWidth={9}
                      onMouseEnter={hover(m)}
                      onMouseMove={hover(m)}
                      onMouseLeave={() => setTip(null)}
                      onClick={(ev) => {
                        setTip(null);
                        onOpen(m.n, ev.currentTarget);
                      }}
                    />
                  </g>
                );
              })}
            </g>
          ))}
          <line x1={nowX} x2={nowX} y1={14} y2={bottom - 6} stroke="var(--ink)" />
          <text x={nowX + (narrow ? -4 : 6)} y={bottom + 8} fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor={narrow ? "end" : "start"}>
            Data as of {asOfText(file.generated_for)}
          </text>
        </svg>
        {tip && (
          <div className="tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            <b>{file.trials[tip.m.n]?.t ?? tip.m.n}</b>
            <span>
              {tip.m.drug} · {file.sponsors[tip.m.sp]?.parent ?? "Unknown sponsor"}
            </span>
            <span>
              {tip.m.n} · {phaseText(tip.m)} · {tip.m.y === null ? "dates not given" : `${tip.m.y}–${tip.m.y2 ?? "?"}${tip.m.est ? " (expected)" : ""}`} ·{" "}
              {tip.m.via ? `Advanced, through ${tip.m.via}` : MARK_LABEL[st(tip.m)]}
            </span>
          </div>
        )}
      </div>
      <div className="tl-legend" aria-label="Legend">
        <span>
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" x2="16" y1="4" y2="4" stroke="var(--red)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="17" cy="4" r="3" fill="var(--red)" />
          </svg>
          Advanced
        </span>
        <span>
          <svg width="26" height="8" aria-hidden="true">
            <circle cx="4" cy="4" r="3" fill="none" stroke="var(--run)" strokeWidth="1.4" />
            <line x1="7" x2="15" y1="4" y2="4" stroke="var(--run)" strokeWidth="3" />
            <line x1="15" x2="25" y1="4" y2="4" stroke="var(--run)" strokeWidth="1.6" strokeDasharray="2 2.5" />
          </svg>
          Running
        </span>
        <span>
          <svg width="20" height="8" aria-hidden="true">
            <line x1="1" x2="16" y1="4" y2="4" stroke="var(--stop)" strokeWidth="3" />
            <line x1="16" x2="16" y1="0" y2="8" stroke="var(--stop)" strokeWidth="1.6" />
          </svg>
          Stopped
        </span>
        <span>
          <svg width="18" height="8" aria-hidden="true">
            <line x1="1" x2="16" y1="4" y2="4" stroke="var(--fin)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Finished, no follow-on
        </span>
        {undated > 0 && <span className="tl-undated">{undated} undated {undated === 1 ? "trial is" : "trials are"} not drawn</span>}
      </div>
      <button type="button" className="tl-toggle" aria-expanded={list} onClick={() => setList((v) => !v)}>
        List these trials
      </button>
      {list && (
        <ul className="tl-list" aria-label="Trials">
          {[...marks]
            .sort((a, b) => (a.y ?? Infinity) - (b.y ?? Infinity) || a.n.localeCompare(b.n))
            .map((m) => (
              <li key={m.n + m.drug}>
                <Mark m={m} state={st(m)} />
                <button type="button" onClick={(e) => onOpen(m.n, e.currentTarget)}>
                  {m.n}
                </button>
                <span>
                  {file.trials[m.n]?.t ?? m.n} · {m.drug} · {file.sponsors[m.sp]?.parent ?? "Unknown sponsor"} · {phaseText(m)} ·{" "}
                  {m.y === null ? "dates not given" : `${m.y} to ${m.y2 === null ? "no end date given" : m.y2 + (m.est ? " (expected)" : "")}`} ·{" "}
                  {m.via ? `Advanced, through ${m.via}` : MARK_LABEL[st(m)]}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
