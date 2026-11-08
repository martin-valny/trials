import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { markState, MARK_LABEL } from "../../lib/pipeline";
import type { PipelineFile, PipelineMark } from "../../types";

interface Props {
  nct: string;
  file: PipelineFile;
  rowId?: string;
  /** The disease or column the mark was drawn in (decides whether "advanced" holds, R21). */
  disease?: string | null;
  onClose: () => void;
  variant: "popover" | "sheet";
  style?: React.CSSProperties;
}

export function phaseText(m: PipelineMark): string {
  if (m.span) return `Phase ${m.span}`;
  return m.c === 4 ? "Phase 4 (approved use)" : `Phase ${m.c}`;
}

function find(file: PipelineFile, nct: string, rowId?: string): { m: PipelineMark; label: string } | null {
  const rows = rowId ? [...file.rows.filter((r) => r.id === rowId), ...file.rows] : file.rows;
  for (const r of rows) {
    const m = r.marks.find((x) => x.n === nct);
    if (m) return { m, label: r.label };
  }
  return null;
}

/** Spec §7.3: one card for the figure (popover or bottom sheet) and, later, the target page. */
export function TrialCard({ nct, file, rowId, disease = null, onClose, variant, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && !ref.current?.contains(t) && !t.closest(".m")) onClose();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", down);
    };
  }, [onClose]);

  const hit = find(file, nct, rowId);
  const info = file.trials[nct];
  if (!hit) return null;
  const { m } = hit;
  const sp = file.sponsors[m.sp];
  const state = markState(m, disease);
  const dates = m.y === null ? "dates not given" : `${m.y} to ${m.y2 === null ? "no end date given" : `${m.y2}${m.est ? " (expected)" : ""}`}`;
  const stateText = m.via ? `Advanced, through ${m.via}` : MARK_LABEL[state];
  return (
    <div
      ref={ref}
      className={`trial-card ${variant}`}
      role="dialog"
      aria-label={`Trial ${nct}`}
      style={style}
    >
      <div className="tc-head">
        <span className="tc-nct">{nct}</span>
        <button type="button" className="tc-x" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="tc-title">{info?.t ?? nct}</p>
      <dl className="tc-facts">
        <dt>Drug</dt>
        <dd>{m.drug}</dd>
        <dt>Sponsor</dt>
        <dd>
          {sp?.parent ?? "Unknown sponsor"}
          {sp && sp.raw !== sp.parent && <small> ({sp.raw})</small>}
        </dd>
        <dt>Phase</dt>
        <dd>{phaseText(m)}</dd>
        <dt>Dates</dt>
        <dd>{dates}</dd>
        <dt>State</dt>
        <dd>
          <i className={`m ${state}`} aria-hidden="true" /> {stateText}
        </dd>
      </dl>
      {state === "stop" && info?.why && <blockquote className="tc-why">{info.why}</blockquote>}
      <div className="tc-actions">
        <Link to={`/trial/${nct}`}>Open trial page</Link>
        <a href={`https://clinicaltrials.gov/study/${nct}`} target="_blank" rel="noreferrer">
          ClinicalTrials.gov ↗
        </a>
      </div>
    </div>
  );
}
