import { useMemo, type ReactNode } from "react";
import { diseaseColor, OUTCOMES, outcomeColor, type ColorMode, type Palette } from "../../lib/explorer";
import { outcomeLabel, phaseLabel } from "../../lib/format";
import type { ExplorerTrial } from "../../types";
import { MODES, phasesOf, useCounts } from "./Toolbar";

export interface LegendBarProps {
  trials: ExplorerTrial[];
  /** Every condition label in the file, in the area's order. */
  conditions: string[];
  order: string[];
  mode: ColorMode;
  palette: Palette;
  /** Panel d. */
  children?: ReactNode;
}

interface Key {
  label: string;
  swatch: string;
  ring?: boolean;
}

/**
 * Under the plate's ink rule: the key to the active colouring (swatches and words, nothing to press),
 * then panel d. Panel d is its own block so on narrow screens it can stick to the bottom of the viewport.
 */
export function LegendBar(p: LegendBarProps) {
  const { trials, mode, palette, order, conditions } = p;
  const counts = useCounts(trials);
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
    // Disease colours go by a trial's first label, so the key lists the conditions that come first somewhere.
    const first = new Set(trials.map((t) => t.condition_labels[0]).filter((c) => c !== undefined));
    return conditions.filter((c) => first.has(c)).map((c) => ({ label: c, swatch: diseaseColor(c, palette, order) }));
  }, [mode, palette, order, conditions, counts, trials]);
  const name = MODES.find(([m]) => m === mode)?.[1] ?? "";

  return (
    <>
      <div className="legend legend-key">
        <span className="legend-k" aria-hidden="true">
          {name}
        </span>
        <ul className="legend-v key-list" aria-label={`Colour key: ${name}`}>
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
      <div className="legend legend-d">{p.children}</div>
    </>
  );
}
