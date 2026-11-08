import { useEffect, useState } from "react";
import { loadTrial } from "../../data";
import { approachText, mechanismText, modalityText, targetsText, type ApproachNames } from "../../lib/explorer";
import { firstSentences, outcomeLabel, phaseLabel } from "../../lib/format";
import type { ExplorerTrial } from "../../types";

type Summary = { nct: string; text: string | null };

/** "a, b, c and 9 more". */
function drugList(drugs: string[]): string | null {
  if (drugs.length === 0) return null;
  const head = drugs.slice(0, 3).join(", ");
  return drugs.length > 3 ? `${head} and ${drugs.length - 3} more` : head;
}

/**
 * The facts line's parts after the NCT number: drugs, mechanism, targets, modality, approach (with its kinds,
 * when ``names`` are given), phase, outcome, enrollment, sponsor (missing ones left out).
 */
function factsOf(trial: ExplorerTrial, names?: ApproachNames): [string, string][] {
  const all: [string, string | null][] = [
    ["drugs", drugList(trial.drugs)],
    ["mechanism", mechanismText(trial)],
    ["targets", targetsText(trial)],
    ["modality", modalityText(trial)],
    ["approach", names ? approachText(trial, names) : null],
    ["phase", phaseLabel(trial.phase)],
    ["outcome", outcomeLabel(trial.outcome)],
    ["enrollment", trial.enrollment !== null ? `${trial.enrollment.toLocaleString("en-US")}\u00a0enrolled` : null],
    ["sponsor", trial.lead_sponsor],
  ];
  return all.filter((f): f is [string, string] => f[1] !== null);
}

function Facts({ trial, names }: { trial: ExplorerTrial; names?: ApproachNames }) {
  return (
    <>
      <b>{trial.nct_id}</b>
      {factsOf(trial, names).map(([field, f]) => (
        <span key={field}> · {f}</span>
      ))}
    </>
  );
}

export const SELECTED_ID = "explore-selected";

/**
 * On narrow screens: only the selected trial's facts line, stuck to the bottom of the viewport, with a link
 * down to the full panel d. Hidden on wide screens, where d sits beside the controls.
 */
export function SelectedBar({ trial, names }: { trial: ExplorerTrial | null; names?: ApproachNames }) {
  if (trial === null) return null;
  return (
    <div className="selected-bar">
      <p className="selected-facts" aria-hidden="true">
        <Facts trial={trial} names={names} />
      </p>
      <button
        type="button"
        className="selected-more"
        onClick={() => document.getElementById(SELECTED_ID)?.scrollIntoView?.({ block: "center" })}
      >
        Details<span className="visually-hidden"> of the selected trial</span>
      </button>
    </div>
  );
}

/** Panel d: the selected trial's facts and the start of its registry summary, loaded on demand. */
export function SelectedTrial({ trial, names }: { trial: ExplorerTrial | null; names?: ApproachNames }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const nct = trial?.nct_id ?? null;

  useEffect(() => {
    if (nct === null) return;
    let alive = true;
    loadTrial(nct)
      .then((doc) => {
        const text = doc?.brief_summary ? firstSentences(doc.brief_summary) : null;
        if (alive) setSummary({ nct, text });
      })
      .catch(() => alive && setSummary({ nct, text: null }));
    return () => {
      alive = false;
    };
  }, [nct]);

  const loaded = summary !== null && summary.nct === nct ? summary : null;

  return (
    <>
      <span className="legend-k panel-l" aria-hidden="true">
        d
      </span>
      <section id={SELECTED_ID} className="legend-v selected" aria-label="Selected trial" aria-live="polite">
        {trial === null ? (
          <p className="selected-empty">
            Click a dot in <b>a</b>, or search and press Enter, to read a trial here.
          </p>
        ) : (
          <>
            <p className="selected-facts">
              <Facts trial={trial} names={names} />
            </p>
            <p className="selected-summary">
              <span className="selected-src">From the registry</span>{" "}
              {loaded === null ? (
                <span className="selected-wait">Loading the summary…</span>
              ) : loaded.text !== null ? (
                <span>{loaded.text}</span>
              ) : (
                <span className="selected-wait">No summary was registered.</span>
              )}
            </p>
            <p className="selected-links">
              <a href={`#/trial/${trial.nct_id}`}>Trial page</a>
              <a href={`https://clinicaltrials.gov/study/${trial.nct_id}`} target="_blank" rel="noreferrer">
                ClinicalTrials.gov
              </a>
            </p>
          </>
        )}
      </section>
    </>
  );
}
