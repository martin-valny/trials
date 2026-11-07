import { useMemo, useState } from "react";
import { liftSentence, modalityLabel, successGroups } from "../../lib/explorer";
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
            // Under min_group (row.rate is null) there is no percentage: the outline bar, the counts
            // and "too few to tell" only. The outline still sits at the raw share, as the contract draws it.
            const few = row.finished < minGroup;
            const raw = row.finished > 0 ? row.succeeded / row.finished : null;
            const name = by === "modality" ? modalityLabel(row.group) : row.group;
            return (
              <li className={few ? "bar few" : "bar"} key={row.group}>
                <span className="bar-label">{name}</span>
                <span className="bar-track" aria-hidden="true">
                  {raw !== null && raw > 0 ? <span className="bar-fill" style={{ width: pct(raw) }} /> : null}
                  {avg !== null ? <span className="bar-avg" style={{ left: pct(avg) }} /> : null}
                </span>
                <span className="bar-n">
                  {row.rate !== null ? pct(row.rate) : "—"}
                  <span className="visually-hidden">
                    {row.rate !== null
                      ? ` (${fmt(row.succeeded)} of ${fmt(row.finished)} finished trials)`
                      : row.finished > 0
                        ? ` (too few to tell: ${fmt(row.succeeded)} of ${fmt(row.finished)} finished trials)`
                        : " (no finished trials yet)"}
                  </span>
                </span>
                <span className="bar-k">
                  <span aria-hidden="true">
                    {fmt(row.succeeded)}/{fmt(row.finished)}
                  </span>
                  {few && row.finished > 0 ? <span className="bar-few">too few to tell</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {by !== "disease" ? (
        <p className="panel-note">Trials with several {by === "modality" ? "modalities" : "mechanisms"} count in each.</p>
      ) : null}
      {avg !== null ? <p className="panel-note">Tick: average across all finished trials that could succeed ({pct(avg)}).</p> : null}
      {rows.some((r) => r.finished < minGroup) ? (
        <p className="panel-note">Outlined: fewer than {minGroup} finished trials.</p>
      ) : null}
      <p className="panel-claim">{liftSentence(stats)}</p>
      {stats.lift !== null ? <p className="panel-note">{basisNote(stats, k)}</p> : null}
      {/* The statistic compares trials that study similar things; mechanisms are left out of it. */}
      <p className="panel-note">
        Similar = same disease, treatment type, molecule and population. Which mechanisms do well:
        By mechanism, above.
      </p>
      <p className="panel-note">
        Succeeded = drug moved to a later phase. <a href="#/methods#map">How this is measured</a>
      </p>
    </section>
  );
}
