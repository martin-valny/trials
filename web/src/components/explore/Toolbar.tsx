import { useMemo, useRef } from "react";
import {
  approachColor,
  approachesOf,
  approachLabel,
  categoryColor,
  categorySeries,
  diseaseColor,
  firstLabels,
  DIMENSION_HINTS,
  filterCounts,
  filtersFor,
  mechanismLabel,
  mechanismsOf,
  modalitiesOf,
  modalityLabel,
  MODES,
  NONE,
  OUTCOMES,
  outcomeColor,
  paintedClasses,
  phasesOf,
  sameFilters,
  type ColorMode,
  type Filters,
  type Palette,
  type SetKey,
  UNCLASSIFIED,
} from "../../lib/explorer";
import { outcomeLabel, phaseLabel, treatmentLabel } from "../../lib/format";
import type { ApproachInfo, ExplorerTrial } from "../../types";
import { MultiSelect, type MultiSelectOption } from "./MultiSelect";
import { YearRange } from "./YearRange";

export interface ToolbarProps {
  trials: ExplorerTrial[];
  filters: Filters;
  onFilters(f: Filters): void;
  bounds: [number, number];
  /** Every condition label in the file, in the area's order. */
  conditions: string[];
  /** The order disease colours are dealt in (diseaseSeries). */
  series: string[];
  /** The mechanism classes that take the colour series (mechanismSeries). */
  mechanismSeries: string[];
  /** The approach vocabulary in order (ExplorerFile.approaches). */
  approaches: ApproachInfo[];
  mode: ColorMode;
  onMode(m: ColorMode): void;
  palette: Palette;
  shown: number;
  /** Enter in the search box: select the first matching trial. */
  onFind(): void;
  onReset(): void;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

/** A small drawn magnifier, hairline ink, set inside the search pill. */
function FindGlyph() {
  return (
    <svg className="find-glyph" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="5" cy="5" r="3.75" />
      <path d="M7.75 7.75 11 11" />
    </svg>
  );
}

/**
 * The controls above the map, set like a figure's legend line: find, colour, the results pill, then the
 * filters as dropdowns and Reset all, with the count of trials shown closing the row.
 */
export function Toolbar(p: ToolbarProps) {
  const { trials, filters, mode, palette } = p;
  const counts = useMemo(() => filterCounts(trials), [trials]);
  const find = useRef<HTMLInputElement>(null);
  // Reset all returns to every value in the file and the full year span; it is idle while that is shown.
  const pristine = useMemo(
    () => sameFilters(filters, { ...filtersFor(trials, p.conditions), years: p.bounds }),
    [trials, filters, p.conditions, p.bounds],
  );

  const withResults = useMemo(() => trials.filter((t) => t.has_results).length, [trials]);

  const set = (key: SetKey) => (next: Set<string>) => p.onFilters({ ...filters, [key]: next });

  const first = useMemo(() => firstLabels(trials), [trials]);

  // A class gets a swatch only when some trial is painted its colour (the figure key's rule).
  const painted = useMemo(
    () => ({
      mechanism: paintedClasses(trials, "mechanism"),
      modality: paintedClasses(trials, "modality"),
      approach: paintedClasses(trials, "approach"),
    }),
    [trials],
  );

  const options = useMemo(() => {
    // Disease colour goes by a trial's first label: a condition no trial lists first is never painted.
    const disease: MultiSelectOption[] = p.conditions.map((c) => ({
      value: c,
      label: c,
      n: counts.conditions.get(c) ?? 0,
      swatch: mode === "disease" && first.has(c) ? diseaseColor(c, palette, p.series) : undefined,
    }));
    const phase: MultiSelectOption[] = phasesOf(counts.phases).map((ph) => ({
      value: ph,
      label: phaseLabel(ph),
      n: counts.phases.get(ph) ?? 0,
      swatch: mode === "phase" ? (palette.phases[ph] ?? palette.unknown) : undefined,
    }));
    const outcome: MultiSelectOption[] = OUTCOMES.map((o) => ({
      value: o,
      label: outcomeLabel(o),
      n: counts.outcomes.get(o) ?? 0,
      swatch: mode === "outcome" ? outcomeColor(o, palette) : undefined,
      ring: o === "unknown",
    }));
    const treatment: MultiSelectOption[] = [...counts.treatmentTypes.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([x, n]) => ({ value: x, label: treatmentLabel(x), n }));
    // Mechanism and modality: a trial with several classes is listed under each; NONE stands for none.
    const category = (m: "mechanism" | "modality", keys: string[], c: Map<string, number>, name: (k: string) => string) =>
      keys.map((k) => ({
        value: k,
        label: name(k),
        n: c.get(k) ?? 0,
        swatch:
          mode === m && painted[m].has(k)
            ? categoryColor(k === NONE ? [] : [k], palette, categorySeries(m, p.mechanismSeries))
            : undefined,
        none: k === NONE,
      }));
    // Every set holds NONE (see filtersFor), so its row is always offered, last.
    const withNone = (c: Map<string, number>) => (c.has(NONE) ? c : new Map([...c, [NONE, 0]]));
    const mechanisms = withNone(counts.mechanisms);
    const modalities = withNone(counts.modalities);
    const mechanism = category("mechanism", mechanismsOf(mechanisms), mechanisms, mechanismLabel);
    const modality = category("modality", modalitiesOf(modalities), modalities, modalityLabel);
    // Approach: the approaches some trial is in, in the vocabulary's order; "No approach" only when some
    // trial has none (a file built without the approach config).
    const names = { approaches: p.approaches };
    const approach: MultiSelectOption[] = approachesOf(counts.approaches, names).map((k) => ({
      value: k,
      label: approachLabel(k, names),
      n: counts.approaches.get(k) ?? 0,
      swatch: mode === "approach" && painted.approach.has(k) ? approachColor(k === NONE ? [] : [k], palette) : undefined,
      // Unclassified and none share the pale ground, so their swatch takes the hairline border.
      none: k === NONE || k === UNCLASSIFIED,
    }));
    return { disease, phase, outcome, treatment, mechanism, modality, approach };
  }, [counts, mode, palette, p.conditions, p.series, p.mechanismSeries, p.approaches, first, painted]);

  return (
    <div className="toolbar" role="group" aria-label="Map controls">
      <div className="tb-find">
        <label className="visually-hidden" htmlFor="explore-find">
          Find a trial
        </label>
        <FindGlyph />
        <input
          ref={find}
          id="explore-find"
          type="search"
          value={filters.query}
          placeholder="NCT, drug or sponsor"
          aria-describedby="explore-find-hint"
          onChange={(e) => p.onFilters({ ...filters, query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              p.onFind();
            }
          }}
        />
        <span className="visually-hidden" id="explore-find-hint">
          Matches NCT number, drug, sponsor or title. Press Enter to open the first match in the trial card below.
        </span>
      </div>

      <div className="tb-colour">
        <span className="tb-k" id="tb-colour" aria-hidden="true">
          Colour
        </span>
        <div className="segmented" role="group" aria-label="Colour">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              title={m === "mechanism" || m === "modality" ? DIMENSION_HINTS[m] : undefined}
              onClick={() => p.onMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tb-results">
        {/* A narrowing: off (the default) shows every trial; on keeps only those with results posted. */}
        <button
          type="button"
          className="pill narrowing"
          aria-pressed={filters.resultsOnly}
          onClick={() => p.onFilters({ ...filters, resultsOnly: !filters.resultsOnly })}
        >
          Results posted <span className="pill-n">{fmt(withResults)}</span>
        </button>
      </div>

      <div className="tb-filters">
        <MultiSelect
          label="Disease"
          options={options.disease}
          selected={filters.conditions}
          onChange={set("conditions")}
          searchable={options.disease.length > 8}
        />
        <MultiSelect label="Phase" options={options.phase} selected={filters.phases} onChange={set("phases")} />
        <MultiSelect
          label="Outcome"
          options={options.outcome}
          selected={filters.outcomes as ReadonlySet<string>}
          onChange={set("outcomes")}
        />
        <MultiSelect
          label="Intervention type"
          hint={DIMENSION_HINTS.treatment}
          options={options.treatment}
          selected={filters.treatmentTypes}
          onChange={set("treatmentTypes")}
        />
        <MultiSelect
          label="Drug target class"
          hint={DIMENSION_HINTS.mechanism}
          options={options.mechanism}
          selected={filters.mechanisms}
          onChange={set("mechanisms")}
          searchable
        />
        <MultiSelect
          label="Drug format"
          hint={DIMENSION_HINTS.modality}
          options={options.modality}
          selected={filters.modalities}
          onChange={set("modalities")}
        />
        <MultiSelect
          label="Approach"
          options={options.approach}
          selected={filters.approaches}
          onChange={set("approaches")}
        />
        <YearRange bounds={p.bounds} value={filters.years} onChange={(years) => p.onFilters({ ...filters, years })} />
      </div>

      <div className="tb-reset">
        {/* Reset all disables itself, so focus moves on to Find rather than falling to the page. */}
        <button
          type="button"
          className="text-button"
          disabled={pristine}
          onClick={() => {
            p.onReset();
            find.current?.focus();
          }}
        >
          Reset all
        </button>
      </div>
      <div className="tb-count">
        Showing {fmt(p.shown)} of {fmt(trials.length)} trials
      </div>
    </div>
  );
}
