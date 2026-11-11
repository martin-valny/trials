import type { ChangeItem } from "../types";
import { fieldLabel, formatDate, formatDelta, formatValue, keepWhole, reasonLabel } from "../lib/format";

/** An old or new value in a change row; a short one (a date, a status, a number) is kept on one line. */
export function Value({ className, text }: { className: "old" | "new"; text: string }) {
  return <span className={keepWhole(text) ? `${className} ch-nb` : className}>{text}</span>;
}

/** Full change history for one trial (all-time, newest first). */
export function ChangeTable({ items }: { items: ChangeItem[] }) {
  return (
    <table className="changes history">
      <caption>All recorded changes ({items.length})</caption>
      <thead>
        <tr>
          <th scope="col">Detected</th>
          <th scope="col">Field</th>
          <th scope="col">Change</th>
          <th scope="col">Why notable</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={`${i.field}|${i.detected_date}|${String(i.new_value)}`}>
            <td data-label="Detected">{formatDate({ date: i.detected_date, precision: "day", type: null })}</td>
            <td data-label="Field">{fieldLabel(i.field)}</td>
            <td data-label="Change">
              <Value className="old" text={formatValue(i.field, i.old_value)} />
              <span aria-hidden="true"> → </span>
              <span className="visually-hidden"> changed to </span>
              <Value className="new" text={formatValue(i.field, i.new_value)} />
              {formatDelta(i.delta_days) ? (
                <div className="delta">{formatDelta(i.delta_days)}</div>
              ) : null}
            </td>
            <td data-label="Why notable">{i.notable ? reasonLabel(i.notable_reason) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
