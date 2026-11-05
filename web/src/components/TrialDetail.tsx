import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadTrial } from "../data";
import { fieldLabel, formatDate, formatValue } from "../lib/format";
import type { DateInfo, TrialFile } from "../types";
import { ChangeTable } from "./ChangeTable";

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
      <section>
        <h1>Trial not found</h1>
        <p>
          No trial {nct} in the tracked set. <Link to="/changes">Back to the changes feed</Link>
        </p>
      </section>
    );
  }

  const t = current.trial;
  const timeline = t.changes.filter((c) => TIMELINE_FIELDS.has(c.field));
  const facts: [string, string][] = [
    ["Status", t.overall_status],
    ["Phase", formatValue("phases", t.phases)],
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
  ];

  return (
    <article aria-labelledby="trial-title">
      <p>
        <Link to="/changes">← Changes</Link>
      </p>
      <h1 id="trial-title">{t.title}</h1>
      <p className="muted">
        {t.nct_id} ·{" "}
        <a href={t.source_url} target="_blank" rel="noopener noreferrer">
          View on ClinicalTrials.gov
        </a>
      </p>
      {t.why_stopped ? <p className="callout">Why stopped: {t.why_stopped}</p> : null}

      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <p className="placeholder">Target: not yet mapped (coming in enrichment)</p>

      <h2>Timeline</h2>
      {timeline.length === 0 ? (
        <p>No status or date changes recorded since tracking began.</p>
      ) : (
        <ol className="timeline">
          {timeline.map((c) => (
            <li key={`${c.field}|${c.detected_date}|${String(c.new_value)}`}>
              <strong>{c.detected_date}</strong> — {fieldLabel(c.field)}:{" "}
              {formatValue(c.field, c.old_value)} → {formatValue(c.field, c.new_value)}
            </li>
          ))}
        </ol>
      )}

      <h2>Change history</h2>
      {t.changes.length === 0 ? (
        <p>No changes recorded since tracking began.</p>
      ) : (
        <ChangeTable items={t.changes} />
      )}
    </article>
  );
}
