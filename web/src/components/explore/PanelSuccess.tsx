import { liftSentence } from "../../lib/explorer";
import type { ExplorerStats } from "../../types";

const pct = (r: number): string => `${Math.round(r * 100)}%`;

/** Panel b: per condition, the share of finished trials that succeeded, against the area average. */
export function PanelSuccess({ stats }: { stats: ExplorerStats }) {
  const avg = stats.success_rate;
  return (
    <section className="panel panel-b" aria-labelledby="panel-b-h">
      <h2 className="panel-h" id="panel-b-h">
        <span className="panel-l">b</span>
        Share of finished trials that succeeded
      </h2>
      <ul className="bars">
        {stats.by_condition.map((row) => {
          const rate = row.finished > 0 ? row.succeeded / row.finished : null;
          return (
            <li className="bar" key={row.label}>
              <span className="bar-label">{row.label}</span>
              <span className="bar-track" aria-hidden="true">
                {rate !== null ? <span className="bar-fill" style={{ width: pct(rate) }} /> : null}
                {avg !== null ? <span className="bar-avg" style={{ left: pct(avg) }} /> : null}
              </span>
              <span className="bar-n">
                {rate !== null ? pct(rate) : "—"}
                <span className="visually-hidden">
                  {rate !== null
                    ? ` (${row.succeeded} of ${row.finished} finished trials)`
                    : " (no finished trials yet)"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {avg !== null ? (
        <p className="panel-note">Red tick: average across all finished trials ({pct(avg)}).</p>
      ) : null}
      <p className="panel-claim">{liftSentence(stats)}</p>
      <p className="panel-note">
        Succeeded = drug moved to a later phase. <a href="#/methods#map">How this is measured</a>
      </p>
    </section>
  );
}
