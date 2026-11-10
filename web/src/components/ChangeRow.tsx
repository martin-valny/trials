import { Link } from "react-router-dom";
import { fieldLabel, formatDate, formatDelta, formatValue, reasonLabel, statusLabel } from "../lib/format";
import type { ChangeItem } from "../types";

/** A registry value as a person reads it: statuses as "Recruiting", dates as "6 Nov 2026". */
function valueText(field: string, v: unknown): string {
  return field === "overall_status" && typeof v === "string" ? statusLabel(v) : formatValue(field, v);
}

export function ChangeRow({ item }: { item: ChangeItem }) {
  const delta = formatDelta(item.delta_days);
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
      </td>
      <td data-label="Field" className="ch-field">
        {fieldLabel(item.field)}
      </td>
      <td data-label="Change" className="ch-change">
        <span className="old">{valueText(item.field, item.old_value)}</span>
        <span aria-hidden="true"> → </span>
        <span className="visually-hidden"> changed to </span>
        <span className="new">{valueText(item.field, item.new_value)}</span>
        {delta ? <div className="delta">{delta}</div> : null}
        <div className="ch-date">Detected {formatDate({ date: item.detected_date, precision: "day", type: null })}</div>
      </td>
      <td data-label="Why notable" className="ch-why">
        {item.notable ? reasonLabel(item.notable_reason) : "—"}
      </td>
      <td data-label="Source" className="ch-src">
        <a href={item.source_url} target="_blank" rel="noopener noreferrer">
          ClinicalTrials.gov<span className="visually-hidden"> record for {item.nct_id}</span>
        </a>
      </td>
    </tr>
  );
}
