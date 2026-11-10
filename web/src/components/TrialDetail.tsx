import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { loadTrial } from "../data";
import { fieldLabel, formatAgeRange, formatDate, formatValue, markState, phasesLabel, sexLabel, statusLabel } from "../lib/format";
import { formatPct, formatRange } from "../lib/risk";
import { useRisk } from "../lib/useRisk";
import type { DateInfo, RiskFile, TrialFile } from "../types";
import { ChangeTable } from "./ChangeTable";
import { PageHead } from "./PageHead";
import { RiskFactors } from "./risk/RiskFactors";
import { RiskNote } from "./risk/RiskNote";
import { RiskAxis, RiskScale } from "./risk/RiskScale";
import "./explore/explore.css";
import "./trial.css";

const TIMELINE_FIELDS = new Set([
  "overall_status",
  "start_date",
  "primary_completion_date",
  "completion_date",
]);

type Result = { nct: string; trial: TrialFile | null } | { nct: string; error: string };

const dateText = (d: DateInfo | null): string =>
  d ? `${formatDate(d)}${d.type ? ` (${d.type.toLowerCase()})` : ""}` : "—";

export function TrialDetail() {
  const { nct = "" } = useParams();
  const [result, setResult] = useState<Result | null>(null);
  const risk = useRisk();

  useEffect(() => {
    let live = true;
    loadTrial(nct)
      .then((trial) => live && setResult({ nct, trial }))
      .catch(
        (e: unknown) =>
          live && setResult({ nct, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
    };
  }, [nct]);

  const current = result?.nct === nct ? result : null;
  if (current === null) return <p role="status">Loading trial…</p>;
  if ("error" in current) return <p role="alert">Could not load trial: {current.error}</p>;
  if (current.trial === null) {
    return (
      <div className="page explore trial-page">
        <PageHead title="Trial not found" className="trial-head" />
        <p className="trial-missing">
          No trial {nct} in the tracked set. <Link to="/trials">See all trials →</Link>
        </p>
      </div>
    );
  }

  const t = current.trial;
  const timeline = t.changes.filter((c) => TIMELINE_FIELDS.has(c.field));
  const facts: [string, ReactNode][] = [
    [
      "Status",
      <>
        <i className={`tr-mark ${markState(t.overall_status)}`} aria-hidden="true" />
        {statusLabel(t.overall_status)}
      </>,
    ],
    ["Phase", phasesLabel(t.phases)],
    ["Lead sponsor", t.lead_sponsor ?? "—"],
    [
      "Enrollment",
      t.enrollment === null
        ? "—"
        : `${t.enrollment}${t.enrollment_type ? ` (${t.enrollment_type.toLowerCase()})` : ""}`,
    ],
    ["Start", dateText(t.start_date)],
    ["Primary completion", dateText(t.primary_completion_date)],
    ["Study completion", dateText(t.completion_date)],
    ["Conditions", formatValue("conditions", t.conditions)],
    ["Interventions", t.interventions.map((i) => i.name).join(", ") || "—"],
    ["Sites", `${t.site_count} ${t.site_count === 1 ? "site" : "sites"} in ${t.countries.length} ${t.countries.length === 1 ? "country" : "countries"}`],
    ...(t.why_stopped ? [["Why stopped", t.why_stopped] as [string, ReactNode]] : []),
  ];

  const e = t.eligibility;
  const ages = formatAgeRange(e.min_age_years, e.max_age_years) || null;
  const eligibility = [e.sex === null ? null : sexLabel(e.sex), ages].filter((x): x is string => x !== null).join(", ");

  return (
    <article className="page explore trial-page" aria-labelledby="trial-title">
      <PageHead
        className="trial-head"
        crumb={
          <>
            <Link to="/trials">Trials</Link> / {t.nct_id}
          </>
        }
        title={<span id="trial-title">{t.title}</span>}
        sentence={
          <>
            {t.nct_id} ·{" "}
            <a href={t.source_url} target="_blank" rel="noopener noreferrer">
              View on ClinicalTrials.gov<span aria-hidden="true"> ↗</span>
            </a>
          </>
        }
      />

      <dl className="trial-facts">
        {facts.map(([k, v]) => (
          <div key={k} className={k === "Why stopped" ? "wide" : undefined}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <TrialRisk nct={t.nct_id} risk={risk ?? null} />

      <section className="summary" aria-labelledby="summary-h">
        <h2 id="summary-h">Summary</h2>
        <p className="muted">From the registry</p>
        {t.brief_summary ? <p className="summary-text">{t.brief_summary}</p> : null}
        {eligibility ? <p>Eligibility: {eligibility}</p> : null}
        {t.has_results ? (
          <p>
            <a href={`${t.source_url}#results`} target="_blank" rel="noopener noreferrer">
              Results posted
            </a>
          </p>
        ) : null}
      </section>

      <p className="trial-target">Target: not yet mapped (coming in enrichment)</p>

      <h2>Timeline</h2>
      {timeline.length === 0 ? (
        <p className="trial-empty">No status or date changes recorded since tracking began.</p>
      ) : (
        <ol className="trial-timeline">
          {timeline.map((c) => (
            <li key={`${c.field}|${c.detected_date}|${String(c.new_value)}`}>
              <strong>{formatDate({ date: c.detected_date, precision: "day", type: null })}</strong> — {fieldLabel(c.field)}:{" "}
              {formatValue(c.field, c.old_value)} → {formatValue(c.field, c.new_value)}
            </li>
          ))}
        </ol>
      )}

      <h2>Change history</h2>
      {t.changes.length === 0 ? (
        <p className="trial-empty">No changes recorded since tracking began.</p>
      ) : (
        <ChangeTable items={t.changes} />
      )}
    </article>
  );
}

/** The trial's estimated chance of stopping early, under the status block; nothing when per-trial estimates are off. */
function TrialRisk({ nct, risk }: { nct: string; risk: RiskFile | null }) {
  if (!risk?.trials) return null;
  const r = risk.trials[nct];
  const why = risk.not_scored[nct];
  if (!r) return why ? <p className="muted rk-unscored">Not scored: {why}</p> : null;
  return (
    <section className="rk rk-trial" aria-label="Estimated chance of stopping early">
      <p className="rk-line">
        Estimated chance of stopping early: <b>{formatPct(r.p)}</b> ({formatRange(r.lo, r.hi)}), typical {formatPct(r.typical)} for {r.basis}
      </p>
      <div className="rk-plot">
        <RiskScale p={r.p} lo={r.lo} hi={r.hi} typical={r.typical} />
        <RiskAxis />
      </div>
      {r.factors.length > 0 && (
        <>
          <p className="rk-fh" id={`rk-fh-${nct}`}>
            Main factors
          </p>
          <RiskFactors factors={r.factors} labelledBy={`rk-fh-${nct}`} />
        </>
      )}
      <RiskNote />
    </section>
  );
}
