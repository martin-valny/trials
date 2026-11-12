import { useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { markState } from "../../lib/pipeline";
import { MIN_SUMMARY_N, aboveLine, countAbove, formatPct, formatRange, targetSummary, vsTypical } from "../../lib/risk";
import type { PipelineFile, PipelineMark, RiskFile, RiskTrial } from "../../types";
import { phaseText } from "../pipeline/TrialCard";
import { RiskFactors } from "../risk/RiskFactors";
import { RiskNote } from "../risk/RiskNote";
import { RiskAxis, RiskScale } from "../risk/RiskScale";

const n = (x: number): string => x.toLocaleString("en-US");

/** Rows shown before "Show all": the highest estimates (spec section 4, shorter long panels). */
export const RISK_SHOWN = 8;

interface Props {
  /** risk.json as the page loaded it: undefined while loading, null when absent. */
  risk: RiskFile | null | undefined;
  rowId: string;
  disease?: string | null;
  /** The page's pipeline file, row label and marks (already narrowed to the disease, one per trial). */
  file: PipelineFile;
  label: string;
  marks: PipelineMark[];
  /** The panel's letter (f while the diligence panel trails, g once it leads). */
  letter: string;
}

export interface Row {
  m: PipelineMark;
  t: RiskTrial;
}

/** The running trials with a per-trial estimate, highest first; empty when risk.json carries no per-trial block. */
export function riskRows(risk: RiskFile, marks: PipelineMark[], disease: string | null): Row[] {
  const trials = risk.trials;
  if (!trials) return [];
  return marks
    .filter((m) => trials[m.n] && markState(m, disease) === "run")
    .map((m) => ({ m, t: trials[m.n]! }))
    .sort((a, b) => b.t.p - a.t.p || a.m.n.localeCompare(b.m.n));
}

/** The stop-chance panel: each running trial's estimated chance of stopping early against the typical rate. Absent without risk.json. */
export function TargetRisk({ risk, ...props }: Props) {
  if (!risk) return null;
  return <Panel {...props} risk={risk} />;
}

function Panel({ rowId, disease = null, file, label, marks, risk, letter }: Omit<Props, "risk"> & { risk: RiskFile }) {
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // "Show all" leaves the page; focus goes to the first row it revealed, not to the body.
  const showAll = () => {
    flushSync(() => setAll(true));
    list.current?.children[RISK_SHOWN]?.querySelector<HTMLElement>("a, button")?.focus();
  };
  const rows: Row[] = useMemo(() => riskRows(risk, marks, disease), [risk, marks, disease]);
  const dzLabel = disease ? (file.diseases.find((d) => d.code === disease)?.label ?? disease) : "All diseases";
  const empty = <p className="empty-line">No running trials with an estimate{disease ? " for this disease" : ""}.</p>;

  let body;
  if (!risk.trials) {
    const s = targetSummary(risk, rowId, disease ?? undefined);
    body =
      s && s.n >= MIN_SUMMARY_N ? (
        <p className="rk-sum">
          Median estimate {formatPct(s.median)} across {n(s.n)} running trials; typical {formatPct(s.typical)}.
        </p>
      ) : (s && s.n > 0) || marks.some((m) => markState(m, disease) === "run") ? (
        // Summaries of fewer than MIN_SUMMARY_N trials are left out of risk.json.
        <p className="empty-line">Too few running trials to summarise.</p>
      ) : (
        empty
      );
  } else if (rows.length === 0) {
    body = empty;
  } else {
    const bases = [...new Set(rows.map((r) => r.t.basis))];
    body = (
      <>
        <p className="rk-claim">{aboveLine(countAbove(rows.map((r) => r.t)), rows.length, label)}</p>
        <p className="rk-sub">
          {label} · {dzLabel} · {n(rows.length)} running. Tick = typical for {bases.length === 1 ? bases[0] : "each trial's phase"}.
        </p>
        <div className="rk-head" aria-hidden="true">
          <span>Trial</span>
          <RiskAxis />
          <span>Estimate</span>
        </div>
        <ul className="rk-rows" aria-label="Running trials by estimate" ref={list}>
          {rows.map((r, i) => (
            // Rows past the first eight stay in the page, hidden, so print can show every one.
            <RiskRow key={r.m.n} row={r} file={file} hidden={!all && i >= RISK_SHOWN} />
          ))}
        </ul>
        {!all && rows.length > RISK_SHOWN && (
          <button type="button" className="more-btn rk-all" onClick={showAll}>
            Show all {n(rows.length)} running trials
          </button>
        )}
      </>
    );
  }

  return (
    <section className="sec rk" aria-labelledby={`p${letter}`}>
      <div className="sec-h">
        <span className="ltr" aria-hidden="true">{letter}</span>
        <h2 id={`p${letter}`} tabIndex={-1}>
          Running trials, estimated chance of stopping early
        </h2>
      </div>
      {body}
      <RiskNote />
    </section>
  );
}

function RiskRow({ row: { m, t }, file, hidden }: { row: Row; file: PipelineFile; hidden: boolean }) {
  const [open, setOpen] = useState(false);
  const whyId = useId();
  const company = file.sponsors[m.sp]?.parent ?? "Unknown sponsor";
  return (
    <li className="rk-row" hidden={hidden}>
      <div className="rk-who">
        <div className="rk-nm">
          <b>{t.drug ?? m.drug}</b> · {phaseText(m)} · {company}
        </div>
        <div className="rk-id">
          <Link to={`/trial/${m.n}`}>{m.n}</Link>
          <a href={`https://clinicaltrials.gov/study/${m.n}`} target="_blank" rel="noopener noreferrer">
            ClinicalTrials.gov ↗
          </a>
          {t.factors.length > 0 && (
            <button type="button" className="rk-more" aria-expanded={open} aria-controls={whyId} onClick={() => setOpen((v) => !v)}>
              Main factors
            </button>
          )}
        </div>
      </div>
      <RiskScale p={t.p} lo={t.lo} hi={t.hi} typical={t.typical} />
      <div className="rk-est-t">
        <b data-near={vsTypical(t.p, t.typical, t.lo, t.hi) === "near" || undefined}>{formatPct(t.p)}</b> ({formatRange(t.lo, t.hi)})
        <small>
          {vsTypical(t.p, t.typical, t.lo, t.hi)} typical {formatPct(t.typical)}
        </small>
      </div>
      <div className="rk-why" id={whyId} hidden={!open}>
        {open && <RiskFactors factors={t.factors} />}
      </div>
    </li>
  );
}
