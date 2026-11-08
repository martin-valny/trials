import { Link } from "react-router-dom";
import type { RailRow, Uncategorised } from "../../lib/approaches";

const fmt = (n: number): string => n.toLocaleString("en-US");
const pct = (r: number): string => `${Math.round(r * 100)}%`;

/** The success line under a rail row: a thin bar and its share, or why there is none. */
function SuccessLine({ row }: { row: RailRow }) {
  if (!row.successDefined) {
    return (
      <span className="rail-success">
        <span className="rail-dash" aria-hidden="true" />
        <span className="rail-share">success not defined</span>
      </span>
    );
  }
  const few = row.rate === null;
  const raw = row.finished > 0 ? row.succeeded / row.finished : 0;
  return (
    <span className={few ? "rail-success few" : "rail-success"}>
      <span className="rail-track" aria-hidden="true">
        {raw > 0 ? <span className="rail-fill" style={{ width: pct(raw) }} /> : null}
      </span>
      <span className="rail-share">
        {row.rate !== null
          ? `${pct(row.rate)} advanced`
          : row.finished > 0
            ? `too few to tell (${fmt(row.succeeded)}/${fmt(row.finished)})`
            : "none finished yet"}
      </span>
    </span>
  );
}

/**
 * Panel a: the approaches as a figure legend. Each row is a button (label, trial count, a thin success
 * bar from the pool trials); the selected one carries an ink rule on its left. On narrow screens the
 * rail is a horizontally scrolling row of chips (label and count only).
 */
export function ApproachRail({
  rows,
  selected,
  minGroup,
  onSelect,
  uncategorised,
}: {
  rows: RailRow[];
  selected: string;
  minGroup: number;
  onSelect(key: string): void;
  /** Trials in no approach yet: a footnote, since they are not an approach to open. */
  uncategorised?: Uncategorised;
}) {
  return (
    <nav className="rail" aria-labelledby="rail-h">
      <h2 className="panel-h" id="rail-h">
        <span className="panel-l">a</span>
        Approaches
      </h2>
      <ul className="rail-rows">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              className="rail-row"
              aria-pressed={row.key === selected}
              onClick={() => onSelect(row.key)}
            >
              <span className="rail-label">{row.label}</span>
              <span className="rail-n">{fmt(row.n)}</span>
              <SuccessLine row={row} />
            </button>
          </li>
        ))}
      </ul>
      <p className="panel-note rail-note">
        Bars: how often the drug advanced to the next phase, counted for the drug that advanced. Under {minGroup}{" "}
        finished trials, too few to tell.
      </p>
      {uncategorised && uncategorised.n > 0 ? (
        <p className="panel-note rail-note rail-uncategorised">
          {fmt(uncategorised.n)} {uncategorised.n === 1 ? "trial" : "trials"} not yet categorised ({fmt(uncategorised.u)} unsorted names, {fmt(uncategorised.d)}{" "}
          diagnostic or not a treatment). <Link to="/methods#not-yet-categorised">How we sort →</Link>
        </p>
      ) : null}
    </nav>
  );
}
