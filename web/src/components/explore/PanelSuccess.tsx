import { liftSentence } from "../../lib/explorer";
import type { ExplorerStats } from "../../types";

const pct = (r: number): string => `${Math.round(r * 100)}%`;

/** Below this many finished trials a row's share is drawn as an outline: shown, but not to be leaned on. */
const FEW = 10;

/** Panel b: per condition, the share of finished trials that succeeded, against the area average. */
export function PanelSuccess({ stats }: { stats: ExplorerStats }) {
  const avg = stats.success_rate;
  const anyFew = stats.by_condition.some((row) => row.finished < FEW);
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
            <li className={row.finished < FEW ? "bar few" : "bar"} key={row.label}>
              <span className="bar-label">{row.label}</span>
              <span className="bar-track" aria-hidden="true">
                {rate !== null && rate > 0 ? <span className="bar-fill" style={{ width: pct(rate) }} /> : null}
                {avg !== null ? <span className="bar-avg" style={{ left: pct(avg) }} /> : null}
              </span>
              <span className="bar-n">
                {rate !== null ? pct(rate) : "—"}
                <span className="visually-hidden">
                  {rate !== null
                    ? ` (${row.succeeded.toLocaleString("en-US")} of ${row.finished.toLocaleString("en-US")} finished trials)`
                    : " (no finished trials yet)"}
                </span>
              </span>
              <span className="bar-k" aria-hidden="true">
                {row.succeeded.toLocaleString("en-US")}/{row.finished.toLocaleString("en-US")}
              </span>
            </li>
          );
        })}
      </ul>
      {avg !== null ? <p className="panel-note">Tick: average across all finished trials ({pct(avg)}).</p> : null}
      {anyFew ? <p className="panel-note">Outlined: fewer than {FEW} finished trials.</p> : null}
      <p className="panel-claim">{liftSentence(stats)}</p>
      <p className="panel-note">
        Succeeded = drug moved to a later phase. <a href="#/methods#map">How this is measured</a>
      </p>
    </section>
  );
}
