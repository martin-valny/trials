import { useMemo } from "react";
import { PHASES, phaseKey } from "../../lib/explorer";
import { phaseLabel } from "../../lib/format";
import type { ExplorerTrial } from "../../types";

const fmt = (n: number): string => n.toLocaleString("en-US");

/**
 * Panel c: visible trials per phase, with the succeeded share drawn in the accent colour.
 * Trials without a phase cannot move to a later one, so they sit outside the measure, in the note.
 */
export function PanelPhase({ trials }: { trials: ExplorerTrial[] }) {
  const { cols, unphased } = useMemo(() => {
    const by = new Map<string, { n: number; won: number }>();
    let unphased = 0;
    for (const t of trials) {
      const k = phaseKey(t);
      if (k === "NA") {
        unphased += 1;
        continue;
      }
      const c = by.get(k) ?? { n: 0, won: 0 };
      c.n += 1;
      if (t.outcome === "succeeded") c.won += 1;
      by.set(k, c);
    }
    const rank = (k: string) => (PHASES.includes(k) ? PHASES.indexOf(k) : PHASES.length);
    return {
      cols: [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])),
      unphased,
    };
  }, [trials]);
  const max = Math.max(1, ...cols.map(([, c]) => c.n));
  const won = cols.reduce((a, [, c]) => a + c.won, 0);
  const phased = trials.length - unphased;

  return (
    <section className="panel panel-c" aria-labelledby="panel-c-h">
      <h2 className="panel-h" id="panel-c-h">
        <span className="panel-l">c</span>
        Trials by phase, <span className="swatch-inline" aria-hidden="true" />
        <span className="visually-hidden">accent</span> = drug moved to a later phase
      </h2>
      {cols.length === 0 ? null : (
        <ul className="flow">
          {cols.map(([k, c]) => (
            <li key={k} aria-label={`${phaseLabel(k)}: ${fmt(c.n)} trials, ${fmt(c.won)} succeeded`}>
              <span className="flow-n" aria-hidden="true">
                {fmt(c.n)}
              </span>
              <span className="flow-col" aria-hidden="true">
                <i style={{ height: `${((c.n - c.won) / max) * 100}%` }} />
                <i className="won" style={{ height: `${(c.won / max) * 100}%` }} />
              </span>
              <span className="flow-x" aria-hidden="true">
                {phaseLabel(k)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="panel-note">
        {fmt(won)} of {fmt(phased)} shown trials with a phase succeeded.
      </p>
      {unphased > 0 ? (
        <p className="panel-note">{`+${fmt(unphased)} trials without a phase, outside this measure.`}</p>
      ) : null}
    </section>
  );
}
