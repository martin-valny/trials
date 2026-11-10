import { Link } from "react-router-dom";
import { fieldLabel, formatDate, formatDelta, formatValue, phaseLabel, phasesLabel, reasonLabel, statusLabel } from "../lib/format";
import type { ChangeItem } from "../types";
import { Value } from "./ChangeTable";

/** Tracked fields whose values are registry enums (TRACKED_FIELDS in the pipeline); every other field's values are names and stay as written. */
const ENUM_FIELDS = new Set(["overall_status", "enrollment_type"]);

/** A registry value as a person reads it: enums as words ("Recruiting", "Phase 2", "Actual"), dates as "6 Nov 2026". */
function valueText(field: string, v: unknown): string {
  if (field === "phases" && Array.isArray(v) && v.every((x) => typeof x === "string")) return phasesLabel(v as string[]);
  if (field === "phase" && typeof v === "string") return phaseLabel(v);
  if (ENUM_FIELDS.has(field) && typeof v === "string") return statusLabel(v);
  return formatValue(field, v);
}

export function ChangeRow({ item }: { item: ChangeItem }) {
  const delta = formatDelta(item.delta_days);
  const detected = formatDate({ date: item.detected_date, precision: "day", type: null });
  return (
    <tr>
      <td data-label="Trial" className="ch-trial">
        {item.title === null ? (
          // Removed from the registry results: there is no trial page to link to.
          <span className="ch-nct">{item.nct_id}</span>
        ) : (
          <Link to={`/trial/${item.nct_id}`} className="ch-nct">
            {item.nct_id}
          </Link>
        )}
        <div className="ch-title">{item.title ?? "No longer in the registry results"}</div>
        {item.lead_sponsor ? <div className="ch-sponsor">{item.lead_sponsor}</div> : null}
        {/* Phone only (line 2): the table's Detected line is hidden there. */}
        <span className="ch-when">{detected}</span>
      </td>
      <td data-label="Field" className="ch-field">
        {fieldLabel(item.field)}
      </td>
      <td data-label="Change" className="ch-change">
        <Value className="old" text={valueText(item.field, item.old_value)} />
        <span aria-hidden="true"> → </span>
        <span className="visually-hidden"> changed to </span>
        <Value className="new" text={valueText(item.field, item.new_value)} />
        {/* A breakable space before the delta: on a phone it sits inline and, when it wraps, starts flush left. */}
        {delta ? (
          <>
            <span className="ch-gap"> </span>
            <div className="delta">{delta}</div>
          </>
        ) : null}
        <div className="ch-date">Detected {detected}</div>
      </td>
      <td data-label="Why notable" className={item.notable ? "ch-why" : "ch-why ch-why-none"}>
        {item.notable ? reasonLabel(item.notable_reason) : "—"}
      </td>
      <td data-label="Source" className="ch-src">
        <a href={item.source_url} target="_blank" rel="noopener noreferrer">
          <span className="ch-long">ClinicalTrials.gov</span>
          <span className="ch-short" aria-hidden="true">CT.gov ↗</span>
          {" "}
          <span className="visually-hidden">record for {item.nct_id}</span>
        </a>
      </td>
    </tr>
  );
}
