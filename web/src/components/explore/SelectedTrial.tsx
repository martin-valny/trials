import { useEffect, useState } from "react";
import { loadTrial } from "../../data";
import { firstSentences, outcomeLabel, phaseLabel } from "../../lib/format";
import type { ExplorerTrial } from "../../types";

type Summary = { nct: string; text: string | null };

/** "a, b, c and 9 more". */
function drugList(drugs: string[]): string | null {
  if (drugs.length === 0) return null;
  const head = drugs.slice(0, 3).join(", ");
  return drugs.length > 3 ? `${head} and ${drugs.length - 3} more` : head;
}

/** Panel d: the selected trial's facts and the start of its registry summary, loaded on demand. */
export function SelectedTrial({ trial }: { trial: ExplorerTrial | null }) {
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

  const facts = trial
    ? [
        drugList(trial.drugs),
        phaseLabel(trial.phase),
        outcomeLabel(trial.outcome),
        trial.enrollment !== null ? `${trial.enrollment.toLocaleString("en-US")}\u00a0enrolled` : null,
        trial.lead_sponsor,
      ].filter((x): x is string => x !== null)
    : [];
  const loaded = summary !== null && summary.nct === nct ? summary : null;

  return (
    <>
      <span className="legend-k panel-l" aria-hidden="true">
        d
      </span>
      <section className="legend-v selected" aria-label="Selected trial" aria-live="polite">
        {trial === null ? (
          <p className="selected-empty">
            Click a dot in <b>a</b>, or search and press Enter, to read a trial here.
          </p>
        ) : (
          <>
            <p className="selected-facts">
              <b>{trial.nct_id}</b>
              {facts.map((f) => (
                <span key={f}> · {f}</span>
              ))}
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
