import { useMemo, type ReactNode } from "react";
import {
  diseaseColor,
  firstLabels,
  filterCounts,
  MODES,
  OUTCOMES,
  outcomeColor,
  phasesOf,
  type ColorMode,
  type Palette,
} from "../../lib/explorer";
import { outcomeLabel, phaseLabel } from "../../lib/format";
import type { ExplorerTrial } from "../../types";

export interface ColourKeyProps {
  trials: ExplorerTrial[];
  /** The disease colour order (diseaseSeries): disease mode lists conditions in this order. */
  series: string[];
  mode: ColorMode;
  palette: Palette;
}

interface Key {
  label: string;
  swatch: string;
  ring?: boolean;
}

/**
 * The figure key: one 12px line of swatches and words under panel a's heading, naming the active
 * colouring (nothing to press), closed by a quiet link to the list.
 */
export function ColourKey(p: ColourKeyProps) {
  const { trials, mode, palette, series } = p;
  const counts = useMemo(() => filterCounts(trials), [trials]);
  const keys = useMemo((): Key[] => {
    if (mode === "outcome")
      return OUTCOMES.filter((o) => counts.outcomes.has(o)).map((o) => ({
        label: outcomeLabel(o),
        swatch: outcomeColor(o, palette),
        ring: o === "unknown",
      }));
    if (mode === "phase")
      return phasesOf(counts.phases).map((ph) => ({
        label: phaseLabel(ph),
        swatch: palette.phases[ph] ?? palette.unknown,
      }));
    // Disease colours go by a trial's first label, so the key lists the conditions that come first
    // somewhere, in the area's order (the order their hues are dealt in).
    const first = firstLabels(trials);
    return series.filter((c) => first.has(c)).map((c) => ({ label: c, swatch: diseaseColor(c, palette, series) }));
  }, [mode, palette, series, counts, trials]);
  const name = MODES.find(([m]) => m === mode)?.[1] ?? "";

  return (
    <div className="figure-key">
      <ul className="key-list" aria-label={`Colour key: ${name}`}>
        {keys.map((k) => (
          <li key={k.label}>
            <span
              className={k.ring ? "swatch ring" : "swatch"}
              style={k.ring ? { borderColor: k.swatch } : { background: k.swatch }}
              aria-hidden="true"
            />
            {k.label}
          </li>
        ))}
      </ul>
      <a className="key-list-link" href="#/trials">
        View as list
      </a>
    </div>
  );
}

/**
 * Under the plate's ink rule: panel d, its own block so on narrow screens it can stick to the bottom
 * of the viewport.
 */
export function LegendBar({ children }: { children?: ReactNode }) {
  return <div className="legend legend-d">{children}</div>;
}
