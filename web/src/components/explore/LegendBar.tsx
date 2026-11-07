import { useMemo, type ReactNode } from "react";
import {
  categoryColor,
  categorySeries,
  diseaseColor,
  firstLabels,
  filterCounts,
  mechanismLabel,
  modalityLabel,
  MODES,
  NONE,
  OUTCOMES,
  outcomeColor,
  paintedClasses,
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
  /** The mechanism classes that take the colour series (mechanismSeries). */
  mechanismSeries?: string[];
  mode: ColorMode;
  palette: Palette;
}

interface Key {
  label: string;
  swatch: string;
  ring?: boolean;
  /** The unknown ground: a hairline (--rule) border so the pale swatch reads on the plate. */
  none?: boolean;
}

/**
 * The figure key: one 12px line of swatches and words under panel a's heading, naming the active
 * colouring (nothing to press), closed by a quiet link to the list.
 */
export function ColourKey(p: ColourKeyProps) {
  const { trials, mode, palette, series } = p;
  const mechanismSeries = p.mechanismSeries;
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
    if (mode === "mechanism" || mode === "modality") return categoryKeys(trials, mode, palette, mechanismSeries ?? []);
    // Disease colours go by a trial's first label, so the key lists the conditions that come first
    // somewhere, in the area's order (the order their hues are dealt in).
    const first = firstLabels(trials);
    return series.filter((c) => first.has(c)).map((c) => ({ label: c, swatch: diseaseColor(c, palette, series) }));
  }, [mode, palette, series, mechanismSeries, counts, trials]);
  const name = MODES.find(([m]) => m === mode)?.[1] ?? "";

  return (
    <div className="figure-key">
      <ul className="key-list" aria-label={`Colour key: ${name}`}>
        {keys.map((k) => (
          <li key={k.label}>
            <span
              className={k.ring ? "swatch ring" : k.none ? "swatch none" : "swatch"}
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
 * Mechanism or modality key: only the colours some trial is painted in. The series classes in series
 * order, then other, more than one, and none.
 */
function categoryKeys(trials: ExplorerTrial[], mode: "mechanism" | "modality", palette: Palette, top: string[]): Key[] {
  const series = categorySeries(mode, top);
  const painted = paintedClasses(trials, mode);
  const multiple = trials.some((t) => (mode === "mechanism" ? t.mechanisms : t.modalities).length > 1);
  const name = mode === "mechanism" ? mechanismLabel : modalityLabel;
  const keys: Key[] = series
    .filter((k) => painted.has(k))
    .map((k) => ({ label: name(k), swatch: categoryColor([k], palette, series) }));
  if ([...painted].some((k) => k !== NONE && !series.includes(k)))
    keys.push({ label: mode === "mechanism" ? "Other mechanism" : "Other", swatch: palette.otherCategory });
  // Shape, not shade: more than one class is a hollow ink ring on the map, so a ring in the key.
  if (multiple) keys.push({ label: `More than one ${mode}`, swatch: palette.multiple, ring: true });
  if (painted.has(NONE)) keys.push({ label: name(NONE), swatch: categoryColor([], palette, series), none: true });
  return keys;
}

/**
 * Under the plate's ink rule: panel d, its own block so on narrow screens it can stick to the bottom
 * of the viewport.
 */
export function LegendBar({ children }: { children?: ReactNode }) {
  return <div className="legend legend-d">{children}</div>;
}
