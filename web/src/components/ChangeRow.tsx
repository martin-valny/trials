import { Link } from "react-router-dom";
import { fieldLabel, formatDelta, formatValue, reasonLabel } from "../lib/format";
import type { ChangeItem } from "../types";

export function ChangeRow({ item }: { item: ChangeItem }) {
  const delta = formatDelta(item.delta_days);
  return (
    <tr>
      <td data-label="Trial">
        <Link to={`/trial/${item.nct_id}`}>{item.nct_id}</Link>
        <div className="muted">{item.title ?? "No longer in the registry results"}</div>
        {item.lead_sponsor ? <div className="muted">{item.lead_sponsor}</div> : null}
      </td>
      <td data-label="Field">{fieldLabel(item.field)}</td>
      <td data-label="Change">
        <span className="old">{formatValue(item.field, item.old_value)}</span>
        <span aria-hidden="true"> → </span>
        <span className="visually-hidden"> changed to </span>
        <span className="new">{formatValue(item.field, item.new_value)}</span>
        {delta ? <div className="delta">{delta}</div> : null}
        <div className="muted">Detected {item.detected_date}</div>
      </td>
      <td data-label="Why notable">{item.notable ? reasonLabel(item.notable_reason) : "—"}</td>
      <td data-label="Source">
        <a href={item.source_url} target="_blank" rel="noopener noreferrer">
          ClinicalTrials.gov<span className="visually-hidden"> record for {item.nct_id}</span>
        </a>
      </td>
    </tr>
  );
}
