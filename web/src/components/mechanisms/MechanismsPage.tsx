import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { loadExplorer, loadMeta } from "../../data";
import { isApproachKey, kindTree, railRows, UNSORTED_ROW_PREFIX } from "../../lib/approaches";
import {
  allFilters,
  DARK_PALETTE,
  LIGHT_PALETTE,
  matches,
  OUTCOMES,
  outcomeColor,
  sameFilters,
  tally,
  yearBounds,
  type Filters,
  type Palette,
} from "../../lib/explorer";
import { outcomeLabel } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import type { ExplorerFile, ExplorerTrial, Meta, Outcome } from "../../types";
import { MultiSelect, type MultiSelectOption } from "../explore/MultiSelect";
import { ApproachRail } from "./ApproachRail";
import { KindTree, STRIP_ORDER } from "./KindTree";
import { SidePanel } from "./SidePanel";
import "../explore/explore.css";
import "./mechanisms.css";

const DEFAULT_APPROACH = "targeted";
const fmt = (n: number): string => n.toLocaleString("en-US");

type State =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error" }
  | { state: "ready"; file: ExplorerFile; meta: Meta | null };

function Title() {
  return (
    <h1 className="plate-title">
      <b>Figure 2 |</b> Every trial by how its treatment works: drugs with a molecular target, and the approaches
      without one.
    </h1>
  );
}

/** Route ``/mechanisms/:approach``: an unknown approach goes to Targeted drugs. */
export function MechanismsPage() {
  const { approach } = useParams();
  const [s, setS] = useState<State>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    Promise.all([loadExplorer(), loadMeta().catch(() => null)])
      .then(([file, meta]) => {
        if (alive) setS(file ? { state: "ready", file, meta } : { state: "missing" });
      })
      .catch(() => alive && setS({ state: "error" }));
    return () => {
      alive = false;
    };
  }, []);

  if (!isApproachKey(approach)) return <Navigate to={`/mechanisms/${DEFAULT_APPROACH}`} replace />;
  if (s.state === "loading") {
    return (
      <div className="explore mechanisms" aria-busy="true">
        <div className="plate-title skeleton-line" aria-hidden="true" />
        <div className="mech-plate">
          <div className="rail skeleton-block" aria-hidden="true" />
        </div>
        <p className="visually-hidden" role="status">
          Loading the approaches…
        </p>
      </div>
    );
  }
  if (s.state !== "ready" || s.file.approaches.length === 0) {
    return (
      <div className="explore mechanisms">
        <Title />
        <p className="explore-message">
          {s.state === "error"
            ? "The approaches could not be loaded. Try again shortly."
            : "Approaches appear after the next update."}{" "}
          Meanwhile, every tracked trial is on the <Link to="/explore">map</Link>.
        </p>
      </div>
    );
  }
  return <Plate file={s.file} meta={s.meta} approach={approach} />;
}

/** The two filters this page shares with the map: Disease and Outcome. */
function Filtersbar({
  file,
  conditions,
  filters,
  onFilters,
  palette,
  shown,
  onReset,
  pristine,
}: {
  file: ExplorerFile;
  conditions: string[];
  filters: Filters;
  onFilters(f: Filters): void;
  palette: Palette;
  shown: number;
  onReset(): void;
  pristine: boolean;
}) {
  const options = useMemo(() => {
    const byCondition = tally(file.trials, (t) => t.condition_labels);
    const byOutcome = tally(file.trials, (t) => [t.outcome]);
    const disease: MultiSelectOption[] = conditions.map((c) => ({ value: c, label: c, n: byCondition.get(c) ?? 0 }));
    // The outcome swatches key the trees' outcome strips.
    const outcome: MultiSelectOption[] = OUTCOMES.map((o) => ({
      value: o,
      label: outcomeLabel(o),
      n: byOutcome.get(o) ?? 0,
      swatch: outcomeColor(o, palette),
      ring: o === "unknown",
    }));
    return { disease, outcome };
  }, [file, conditions, palette]);

  return (
    <div className="toolbar mech-toolbar" role="group" aria-label="Approach filters">
      <div className="tb-filters">
        <MultiSelect
          label="Disease"
          options={options.disease}
          selected={filters.conditions}
          onChange={(next) => onFilters({ ...filters, conditions: next })}
          searchable={options.disease.length > 8}
        />
        <MultiSelect
          label="Outcome"
          options={options.outcome}
          selected={filters.outcomes as ReadonlySet<string>}
          onChange={(next) => onFilters({ ...filters, outcomes: next as Set<Outcome> })}
        />
      </div>
      <div className="tb-reset">
        <button type="button" className="text-button" disabled={pristine} onClick={onReset}>
          Reset all
        </button>
      </div>
      <div className="tb-count">
        Showing {fmt(shown)} of {fmt(file.trials.length)} trials
      </div>
    </div>
  );
}

/** The strip's key, under the canvas heading: what each colour in an outcome strip means. */
function StripKey({ palette }: { palette: Palette }) {
  const words: Record<Outcome, string> = {
    succeeded: "Succeeded",
    stopped: "Stopped early",
    completed_unknown: "Completed",
    running: "Running",
    unknown: "Status unknown",
  };
  return (
    <ul className="key-list strip-key" aria-label="Outcome strip key">
      {STRIP_ORDER.map((o) => (
        <li key={o}>
          <span
            className={o === "unknown" ? "swatch ring" : "swatch"}
            style={
              o === "unknown" ? { borderColor: outcomeColor(o, palette) } : { background: outcomeColor(o, palette) }
            }
            aria-hidden="true"
          />
          {words[o]}
        </li>
      ))}
    </ul>
  );
}

function Plate({ file, meta, approach }: { file: ExplorerFile; meta: Meta | null; approach: string }) {
  const dark = useTheme().theme === "dark";
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kindKey = params.get("kind");
  const [filters, setFilters] = useState<Filters>(() => allFilters(file));
  const bounds = useMemo(() => yearBounds(file.trials), [file]);
  const minGroup = file.method.min_group;
  const order = useMemo(() => meta?.conditions ?? file.stats.by_condition.map((c) => c.label), [meta, file]);
  const conditions = useMemo(() => {
    const all = allFilters(file).conditions;
    const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
    return [...all].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [file, order]);
  const pristine = useMemo(() => sameFilters(filters, allFilters(file)), [filters, file]);

  const shown = useMemo(() => file.trials.filter((t) => matches(t, filters, bounds)), [file, filters, bounds]);
  const rows = useMemo(() => railRows(shown, file, minGroup), [shown, file, minGroup]);
  const row = rows.find((r) => r.key === approach) ?? null;
  const tree = useMemo(
    () => (approach === DEFAULT_APPROACH ? [] : kindTree(approach, shown, file, minGroup)),
    [approach, shown, file, minGroup],
  );
  const byNct = useMemo(() => new Map(file.trials.map((t) => [t.nct_id, t])), [file]);

  // The kind ?kind= names, if the filtered tree still has it (otherwise the panel stays closed).
  const selected = useMemo(
    () =>
      tree.flatMap((group) => group.kinds.filter((k) => k.key === kindKey).map((kind) => ({ kind, group })))[0] ?? null,
    [tree, kindKey],
  );

  const rationaleOf = (key: string) => {
    const info = file.kinds[key];
    return info && info.rationale ? { text: info.rationale, url: info.source_url || null } : null;
  };

  const choose = (key: string) => navigate(`/mechanisms/${key}`);
  const openKind = (key: string) => setParams(key === kindKey ? {} : { kind: key }, { replace: true });
  const closeKind = () => {
    const key = kindKey;
    setParams({}, { replace: true });
    if (key !== null) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`.kind-row[data-kind="${CSS.escape(key)}"]`)?.focus(),
      );
    }
  };
  const reset = () => setFilters(allFilters(file));

  const label = row?.label ?? approach;
  const n = row?.n ?? 0;
  const narrowed = !pristine;

  return (
    <div className={selected ? "explore mechanisms has-panel" : "explore mechanisms"}>
      <Title />
      <Filtersbar
        file={file}
        conditions={conditions}
        filters={filters}
        onFilters={setFilters}
        palette={palette}
        shown={shown.length}
        onReset={reset}
        pristine={pristine}
      />
      <div className="mech-plate">
        <ApproachRail rows={rows} selected={approach} minGroup={minGroup} onSelect={choose} />
        <section className="mech-canvas" aria-labelledby="canvas-h" data-sheet-reveal="">
          <h2 className="panel-h" id="canvas-h">
            <span className="panel-l">b</span>
            {label}
            <span className="canvas-sum">
              {" · "}
              {fmt(n)} {n === 1 ? "trial" : "trials"}
              {row && row.successDefined && row.finished > 0
                ? ` · ${fmt(row.finished)} in the success pool, ${fmt(row.succeeded)} succeeded`
                : ""}
            </span>
          </h2>
          {row && !row.successDefined ? (
            <p className="panel-note">
              Success not defined: success here means a drug moved to a later phase, and these treatments are not drugs.
            </p>
          ) : null}
          {n === 0 ? (
            <div className="canvas-empty" role="status">
              <p>{narrowed ? "No trials match these filters." : "No trials in this approach yet."}</p>
              {narrowed ? (
                <button type="button" onClick={reset}>
                  Reset filters
                </button>
              ) : null}
            </div>
          ) : approach === DEFAULT_APPROACH ? (
            // Task 9 draws the drug -> target -> pathway graph here (GraphCanvas).
            <div className="graph-slot" data-graph-slot="">
              <p className="panel-note">The drug → target → pathway graph for these {fmt(n)} trials is drawn here.</p>
            </div>
          ) : (
            <>
              <StripKey palette={palette} />
              <KindTree
                groups={tree}
                selected={selected?.kind.key ?? null}
                successDefined={row?.successDefined ?? true}
                palette={palette}
                rationales={rationaleOf}
                onSelect={openKind}
              />
              {approach === "unclassified" ? (
                <p className="panel-note">
                  Not yet sorted: names not in the drug mapping or the keyword rules, by trial count. Each is a mapping
                  still to decide.
                </p>
              ) : null}
            </>
          )}
        </section>
        {selected ? (
          <SidePanel
            kind={selected.kind}
            group={selected.group.group}
            approach={label}
            rationale={
              selected.kind.key.startsWith(UNSORTED_ROW_PREFIX)
                ? null
                : selected.group.rationale
                  ? { text: selected.group.rationale, url: selected.group.source_url }
                  : rationaleOf(selected.kind.key)
            }
            trials={selected.kind.trials
              .map((nct) => byNct.get(nct))
              .filter((t): t is ExplorerTrial => t !== undefined)}
            successDefined={row?.successDefined ?? true}
            onClose={closeKind}
          />
        ) : null}
      </div>
    </div>
  );
}
