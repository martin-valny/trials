import { useMemo } from "react";
import { PHASES, phaseKey } from "../../lib/explorer";
import { phaseLabel } from "../../lib/format";
import type { ExplorerTrial } from "../../types";

/** Panel c: visible trials per phase, with the succeeded share drawn in the accent colour. */
export function PanelPhase({ trials }: { trials: ExplorerTrial[] }) {
  const cols = useMemo(() => {
    const by = new Map<string, { n: number; won: number }>();
    for (const t of trials) {
      const k = phaseKey(t);
      const c = by.get(k) ?? { n: 0, won: 0 };
      c.n += 1;
      if (t.outcome === "succeeded") c.won += 1;
      by.set(k, c);
    }
    const rank = (k: string) => (PHASES.includes(k) ? PHASES.indexOf(k) : PHASES.length);
    return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }, [trials]);
  const max = Math.max(1, ...cols.map(([, c]) => c.n));
  const won = cols.reduce((a, [, c]) => a + c.won, 0);

  return (
    <section className="panel panel-c" aria-labelledby="panel-c-h">
      <h2 className="panel-h" id="panel-c-h">
        <span className="panel-l">c</span>
        Trials by phase, red = drug moved to a later phase
      </h2>
      {cols.length === 0 ? null : (
        <ul className="flow">
          {cols.map(([k, c]) => (
            <li key={k} aria-label={`${phaseLabel(k)}: ${c.n.toLocaleString("en-US")} trials, ${c.won} succeeded`}>
              <span className="flow-n" aria-hidden="true">
                {c.n.toLocaleString("en-US")}
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
        {won.toLocaleString("en-US")} of {trials.length.toLocaleString("en-US")} shown trials succeeded.
      </p>
    </section>
  );
}
