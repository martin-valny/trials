import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { markState } from "../../lib/pipeline";
import { formatPct, formatRange, targetSummary, vsTypical } from "../../lib/risk";
import { useRisk } from "../../lib/useRisk";
import type { PipelineFile, PipelineMark, RiskFile, RiskTrial } from "../../types";
import { phaseText } from "../pipeline/TrialCard";
import { RiskFactors } from "../risk/RiskFactors";
import { RiskNote } from "../risk/RiskNote";
import { RiskAxis, RiskScale } from "../risk/RiskScale";

const n = (x: number): string => x.toLocaleString("en-US");

interface Props {
  rowId: string;
  disease?: string | null;
  /** The page's pipeline file, row label and marks (already narrowed to the disease, one per trial). */
  file: PipelineFile;
  label: string;
  marks: PipelineMark[];
}

interface Row {
  m: PipelineMark;
  t: RiskTrial;
}

/** Panel e: each running trial's estimated chance of stopping early against the typical rate. Absent without risk.json. */
export function TargetRisk(props: Props) {
  const risk = useRisk();
  if (!risk) return null;
  return <Panel {...props} risk={risk} />;
}

function Panel({ rowId, disease = null, file, label, marks, risk }: Props & { risk: RiskFile }) {
  const rows: Row[] = useMemo(() => {
    const trials = risk.trials;
    if (!trials) return [];
    return marks
      .filter((m) => trials[m.n] && markState(m, disease) === "run")
      .map((m) => ({ m, t: trials[m.n]! }))
      .sort((a, b) => b.t.p - a.t.p || a.m.n.localeCompare(b.m.n));
  }, [risk, marks, disease]);
  const dzLabel = disease ? (file.diseases.find((d) => d.code === disease)?.label ?? disease) : "All diseases";
  const empty = <p className="empty-line">No running trials with an estimate{disease ? " for this disease" : ""}.</p>;

  let body;
  if (!risk.trials) {
    const s = targetSummary(risk, rowId, disease ?? undefined);
    body =
      s && s.n > 0 ? (
        <p className="rk-sum">
          Median estimate {formatPct(s.median)} across {n(s.n)} running {s.n === 1 ? "trial" : "trials"}; typical {formatPct(s.typical)}.
        </p>
      ) : (
        empty
      );
  } else if (rows.length === 0) {
    body = empty;
  } else {
    const bases = [...new Set(rows.map((r) => r.t.basis))];
    body = (
      <>
        <p className="rk-sub">
          {label} · {dzLabel} · {n(rows.length)} running. Tick = typical for {bases.length === 1 ? bases[0] : "each trial's phase"}.
        </p>
        <div className="rk-head" aria-hidden="true">
          <span>Trial</span>
          <RiskAxis />
          <span>Estimate</span>
        </div>
        <ul className="rk-rows" aria-label="Running trials by estimate">
          {rows.map((r) => (
            <RiskRow key={r.m.n} row={r} file={file} />
          ))}
        </ul>
      </>
    );
  }

  return (
    <section className="sec rk" aria-labelledby="pe">
      <div className="sec-h">
        <span className="ltr" aria-hidden="true">e</span>
        <h2 id="pe">Running trials, estimated chance of stopping early</h2>
      </div>
      {body}
      <RiskNote />
    </section>
  );
}

function RiskRow({ row: { m, t }, file }: { row: Row; file: PipelineFile }) {
  const [open, setOpen] = useState(false);
  const company = file.sponsors[m.sp]?.parent ?? "Unknown sponsor";
  return (
    <li className="rk-row">
      <div className="rk-who">
        <div className="rk-nm">
          <b>{m.drug}</b> · {phaseText(m)} · {company}
        </div>
        <div className="rk-id">
          <Link to={`/trial/${m.n}`}>{m.n}</Link>
          {t.factors.length > 0 && (
            <button type="button" className="rk-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              Main factors
            </button>
          )}
        </div>
      </div>
      <RiskScale p={t.p} lo={t.lo} hi={t.hi} typical={t.typical} />
      <div className="rk-est-t">
        <b>{formatPct(t.p)}</b> ({formatRange(t.lo, t.hi)})
        <small>
          {vsTypical(t.p, t.typical)} typical {formatPct(t.typical)}
        </small>
      </div>
      {open && (
        <div className="rk-why">
          <RiskFactors factors={t.factors} />
          <a href={`https://clinicaltrials.gov/study/${m.n}`} target="_blank" rel="noopener noreferrer">
            ClinicalTrials.gov ↗
          </a>
        </div>
      )}
    </li>
  );
}
