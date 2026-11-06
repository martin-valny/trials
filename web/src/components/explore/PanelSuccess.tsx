import { useMemo, useState } from "react";
import { liftSentence, successGroups } from "../../lib/explorer";
import type { SuccessBy } from "../../lib/explorer";
import type { ExplorerStats, ExplorerTrial } from "../../types";

const pct = (r: number): string => `${Math.round(r * 100)}%`;

const VIEWS: [SuccessBy, string][] = [
  ["disease", "By disease"],
  ["modality", "By modality"],
  ["mechanism", "By mechanism"],
];

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
export function PanelSuccess({
  stats,
  k,
  trials,
  minGroup,
}: {
  stats: ExplorerStats;
  k: number;
  trials: ExplorerTrial[];
  minGroup: number;
}) {
  const avg = stats.success_rate;
  const [by, setBy] = useState<SuccessBy>("disease");
  const rows = useMemo(
    () =>
      successGroups(
        trials,
        by,
        minGroup,
        8,
        by === "disease" ? stats.by_condition.map((c) => c.label) : undefined,
      ),
    [trials, by, minGroup, stats.by_condition],
  );
  return (
    <section className="panel panel-b" aria-labelledby="panel-b-h">
      <h2 className="panel-h" id="panel-b-h">
        <span className="panel-l">b</span>
        Share that succeeded, of finished trials that could succeed
      </h2>
      <p className="panel-note">Finished Early Phase 1–Phase 2/3 trials with an experimental drug.</p>
      <div className="panel-switch">
        <div className="segmented" role="group" aria-label="Group by">
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={by === v} onClick={() => setBy(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="panel-note">No finished trials here yet.</p>
      ) : (
        <ul className="bars">
          {rows.map((row) => {
            const few = row.finished < minGroup;
            // Disease view keeps today's outlined bar; modality and mechanism say it in words.
            const tooFew = few && row.finished > 0 && by !== "disease";
            const rate = by === "disease" ? (row.finished > 0 ? row.succeeded / row.finished : null) : row.rate;
            return (
              <li className={few ? "bar few" : "bar"} key={row.group}>
                <span className="bar-label">{row.group}</span>
                {tooFew ? (
                  <span className="bar-few-note">
                    too few to tell ({fmt(row.finished)} finished; needs ≥{minGroup})
                  </span>
                ) : (
                  <>
                    <span className="bar-track" aria-hidden="true">
                      {rate !== null && rate > 0 ? <span className="bar-fill" style={{ width: pct(rate) }} /> : null}
                      {avg !== null ? <span className="bar-avg" style={{ left: pct(avg) }} /> : null}
                    </span>
                    <span className="bar-n">
                      {rate !== null ? pct(rate) : "—"}
                      <span className="visually-hidden">
                        {rate !== null
                          ? ` (${fmt(row.succeeded)} of ${fmt(row.finished)} finished trials)`
                          : " (no finished trials yet)"}
                      </span>
                    </span>
                    <span className="bar-k" aria-hidden="true">
                      {fmt(row.succeeded)}/{fmt(row.finished)}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {by !== "disease" ? <p className="panel-note">Trials with several mechanisms count in each.</p> : null}
      {avg !== null ? <p className="panel-note">Tick: average across all finished trials that could succeed ({pct(avg)}).</p> : null}
      {by === "disease" && rows.some((r) => r.finished < minGroup) ? (
        <p className="panel-note">Outlined: fewer than {minGroup} finished trials.</p>
      ) : null}
      <p className="panel-claim">{liftSentence(stats)}</p>
      {stats.lift !== null ? <p className="panel-note">{basisNote(stats, k)}</p> : null}
      <p className="panel-note">
        Succeeded = drug moved to a later phase. <a href="#/methods#map">How this is measured</a>
      </p>
    </section>
  );
}
