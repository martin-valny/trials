import { liftSentence } from "../../lib/explorer";
import type { ExplorerStats } from "../../types";

const pct = (r: number): string => `${Math.round(r * 100)}%`;

/** Below this many finished trials a row's share is drawn as an outline: shown, but not to be leaned on. */
const FEW = 10;

const fmt = (n: number): string => n.toLocaleString("en-US");

/** "Based on 40 trials that succeeded; 3 had fewer than 10 usable neighbours." (second clause only when some did). */
function basisNote(stats: ExplorerStats, k: number): string {
  const head = `Based on ${fmt(stats.n_averaged)} trials that succeeded`;
  return stats.n_short > 0 ? `${head}; ${fmt(stats.n_short)} had fewer than ${k} usable neighbours.` : `${head}.`;
}

/**
 * Panel b: per condition, the share of finished trials that could succeed (the pool: Early Phase 1 to
 * Phase 2/3 with an experimental drug) that did succeed, against the pool average.
 */
export function PanelSuccess({ stats, k }: { stats: ExplorerStats; k: number }) {
  const avg = stats.success_rate;
  const anyFew = stats.by_condition.some((row) => row.finished < FEW);
  return (
    <section className="panel panel-b" aria-labelledby="panel-b-h">
      <h2 className="panel-h" id="panel-b-h">
        <span className="panel-l">b</span>
        Share that succeeded, of finished trials that could succeed
      </h2>
      <p className="panel-note">Finished Early Phase 1–Phase 2/3 trials with an experimental drug.</p>
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
      {avg !== null ? <p className="panel-note">Tick: average across all finished trials that could succeed ({pct(avg)}).</p> : null}
      {anyFew ? <p className="panel-note">Outlined: fewer than {FEW} finished trials.</p> : null}
      <p className="panel-claim">{liftSentence(stats)}</p>
      {stats.lift !== null ? <p className="panel-note">{basisNote(stats, k)}</p> : null}
      <p className="panel-note">
        Succeeded = drug moved to a later phase. <a href="#/methods#map">How this is measured</a>
      </p>
    </section>
  );
}
