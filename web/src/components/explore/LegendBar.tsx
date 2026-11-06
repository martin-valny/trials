import { useMemo, type ReactNode } from "react";
import {
  diseaseColor,
  OUTCOMES,
  outcomeColor,
  PHASES,
  phaseKey,
  type ColorMode,
  type Filters,
  type Palette,
} from "../../lib/explorer";
import { outcomeLabel, phaseLabel, treatmentLabel } from "../../lib/format";
import type { ExplorerTrial } from "../../types";

export interface LegendBarProps {
  trials: ExplorerTrial[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  /** Every condition label in the file, in the area's order. */
  conditions: string[];
  order: string[];
  mode: ColorMode;
  onMode: (m: ColorMode) => void;
  palette: Palette;
  shown: number;
  /** Enter in the search box: select the first matching trial. */
  onFind: () => void;
  children?: ReactNode;
}

type SetKey = "conditions" | "phases" | "outcomes" | "treatmentTypes";

const MODES: [ColorMode, string][] = [
  ["outcome", "Outcome"],
  ["phase", "Phase"],
  ["disease", "Disease"],
];

const fmt = (n: number): string => n.toLocaleString("en-US");

function tally(trials: ExplorerTrial[], keys: (t: ExplorerTrial) => string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trials) for (const k of keys(t)) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function Pill(props: {
  label: string;
  n: number;
  on: boolean;
  swatch?: string;
  /** Draw the swatch as a hollow ring, matching how the map draws these trials. */
  ring?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="pill" aria-pressed={props.on} onClick={props.onClick}>
      {props.swatch ? (
        <span
          className={props.ring ? "swatch ring" : "swatch"}
          style={props.ring ? { borderColor: props.swatch } : { background: props.swatch }}
          aria-hidden="true"
        />
      ) : null}
      {props.label} <span className="pill-n">{fmt(props.n)}</span>
    </button>
  );
}

/**
 * The legend bar: the selected trial (d) first, right under the ink rule, then search, colour mode and
 * value toggles with counts. Panel d is its own block (a sibling, not a child, of the controls) so on
 * narrow screens it can stick to the bottom of the viewport across the whole page.
 */
export function LegendBar(p: LegendBarProps) {
  const { trials, filters, mode, palette } = p;
  const counts = useMemo(
    () => ({
      conditions: tally(trials, (t) => t.condition_labels),
      phases: tally(trials, (t) => [phaseKey(t)]),
      outcomes: tally(trials, (t) => [t.outcome]),
      treatmentTypes: tally(trials, (t) => t.treatment_types),
    }),
    [trials],
  );
  const phases = useMemo(() => {
    const rank = (k: string) => (PHASES.includes(k) ? PHASES.indexOf(k) : PHASES.length);
    return [...counts.phases.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [counts]);
  const types = useMemo(
    () => [...counts.treatmentTypes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k),
    [counts],
  );

  const toggle = (key: SetKey, value: string) => {
    const next = new Set<string>(filters[key] as Set<string>);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    p.onFilters({ ...filters, [key]: next });
  };

  return (
    <>
      <div className="legend legend-d">{p.children}</div>
      <div className="legend legend-controls">
        <label className="legend-k" htmlFor="explore-find">
          Find a trial
        </label>
        <div className="legend-v find">
          <input
            id="explore-find"
            type="search"
            value={filters.query}
            placeholder="NCT number, drug, sponsor or title"
            aria-describedby="explore-find-hint"
            onChange={(e) => p.onFilters({ ...filters, query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                p.onFind();
              }
            }}
          />
          <span className="count">
            Showing {fmt(p.shown)} of {fmt(trials.length)} trials
          </span>
          <a href="#/trials">View as list</a>
          <span className="visually-hidden" id="explore-find-hint">
            Press Enter to open the first match in panel d.
          </span>
        </div>

        <span className="legend-k" id="legend-colour">
          Colour
        </span>
        <div className="legend-v" role="group" aria-labelledby="legend-colour">
          {MODES.map(([m, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => p.onMode(m)}>
              {label}
            </button>
          ))}
        </div>

        <span className="legend-k" id="legend-outcome">
          Outcome
        </span>
        <div className="legend-v" role="group" aria-labelledby="legend-outcome">
          {OUTCOMES.map((o) => (
            <Pill
              key={o}
              label={outcomeLabel(o)}
              n={counts.outcomes.get(o) ?? 0}
              on={filters.outcomes.has(o)}
              swatch={mode === "outcome" ? outcomeColor(o, palette) : undefined}
              ring={o === "unknown"}
              onClick={() => toggle("outcomes", o)}
            />
          ))}
        </div>

        <span className="legend-k" id="legend-disease">
          Disease
        </span>
        <div className="legend-v" role="group" aria-labelledby="legend-disease">
          {p.conditions.map((c) => (
            <Pill
              key={c}
              label={c}
              n={counts.conditions.get(c) ?? 0}
              on={filters.conditions.has(c)}
              swatch={mode === "disease" ? diseaseColor(c, palette, p.order) : undefined}
              onClick={() => toggle("conditions", c)}
            />
          ))}
        </div>

        <span className="legend-k" id="legend-phase">
          Phase
        </span>
        <div className="legend-v" role="group" aria-labelledby="legend-phase">
          {phases.map((ph) => (
            <Pill
              key={ph}
              label={phaseLabel(ph)}
              n={counts.phases.get(ph) ?? 0}
              on={filters.phases.has(ph)}
              swatch={mode === "phase" ? (palette.phases[ph] ?? palette.unknown) : undefined}
              onClick={() => toggle("phases", ph)}
            />
          ))}
        </div>

        <span className="legend-k" id="legend-type">
          Treatment
        </span>
        <div className="legend-v" role="group" aria-labelledby="legend-type">
          {types.map((x) => (
            <Pill
              key={x}
              label={treatmentLabel(x)}
              n={counts.treatmentTypes.get(x) ?? 0}
              on={filters.treatmentTypes.has(x)}
              onClick={() => toggle("treatmentTypes", x)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
