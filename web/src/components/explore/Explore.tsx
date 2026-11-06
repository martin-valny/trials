import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { loadExplorer, loadMeta } from "../../data";
import {
  allFilters,
  colorFor,
  DARK_PALETTE,
  LIGHT_PALETTE,
  matches,
  yearBounds,
  type ColorMode,
  type Filters,
} from "../../lib/explorer";
import { useTheme } from "../../lib/theme";
import type { ExplorerFile, ExplorerTrial, Meta } from "../../types";
import { ColourKey, LegendBar } from "./LegendBar";
import { Toolbar } from "./Toolbar";
import { PanelPhase } from "./PanelPhase";
import { PanelSuccess } from "./PanelSuccess";
import { HoverCard } from "./HoverCard";
import { PlateCanvas, type PlateHover } from "./PlateCanvas";
import { SelectedBar, SelectedTrial } from "./SelectedTrial";
import "./explore.css";

type State =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error" }
  | { state: "ready"; file: ExplorerFile; meta: Meta | null };

/** Live value of a CSS media query; false where matchMedia is unavailable. */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/** Feature names from the export, read as plain words ("treatment_type" -> "treatment"). */
const featureWords = (features: string[]): string =>
  features.map((f) => f.replace(/_type$/, "").replace(/_/g, " ")).join(", ");

/** ``value`` once it has stayed the same for ``ms`` milliseconds (the first value immediately). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** One sentence for screen readers describing what the map currently shows. */
function summary(shown: ExplorerTrial[]): string {
  const n = (o: ExplorerTrial["outcome"]) => shown.filter((t) => t.outcome === o).length;
  return (
    `${shown.length} trials; ${n("succeeded")} succeeded, ${n("stopped")} stopped early, ` +
    `${n("running")} still running, ${n("completed_unknown")} finished without a known result.`
  );
}

/** Play/pause for the map's slow turn: text plus a glyph drawn in ink at a 1.5px stroke. */
function SpinToggle({ spinning, onToggle }: { spinning: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="spin-toggle"
      aria-pressed={spinning}
      aria-label={spinning ? "Pause rotation" : "Play rotation"}
      onClick={onToggle}
    >
      <svg className="spin-glyph" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
        {spinning ? <path d="M2.75 1.5v7M7.25 1.5v7" /> : <path d="M2.5 1.25 8.5 5l-6 3.75z" />}
      </svg>
      {spinning ? "Pause" : "Play"}
    </button>
  );
}

/** Outcome colouring lifts succeeded trials above the cloud and draws unknown outcomes as rings. */
const isSucceeded = (t: ExplorerTrial): boolean => t.outcome === "succeeded";
const isUnknownOutcome = (t: ExplorerTrial): boolean => t.outcome === "unknown";

function Title({ area }: { area: string | null }) {
  return (
    <h1 className="plate-title">
      <b>Figure 1 |</b> The {area ? `${area} ` : ""}trial landscape, laid out by what each trial
      studies, with outcomes painted on top.
    </h1>
  );
}

export function Explore() {
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

  if (s.state === "loading") {
    return (
      <div className="explore" aria-busy="true">
        <div className="plate-title skeleton-line" aria-hidden="true" />
        <div className="plate">
          <div className="panel panel-a skeleton-block" aria-hidden="true" />
        </div>
        <p className="visually-hidden" role="status">
          Loading the map…
        </p>
      </div>
    );
  }
  if (s.state === "missing" || s.state === "error") {
    return (
      <div className="explore">
        <Title area={null} />
        <p className="explore-message">
          {s.state === "missing"
            ? "The map appears after the next daily update."
            : "The map could not be loaded. Try again shortly."}{" "}
          Meanwhile, every tracked trial is in the <Link to="/trials">trial list</Link>.
        </p>
      </div>
    );
  }
  return <Plate file={s.file} meta={s.meta} />;
}

function Plate({ file, meta }: { file: ExplorerFile; meta: Meta | null }) {
  const dark = useTheme().theme === "dark";
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // A touch screen has no hover, so the caption does not offer one.
  const coarse = useMediaQuery("(pointer: coarse)");
  const [filters, setFilters] = useState<Filters>(() => allFilters(file));
  const [mode, setMode] = useState<ColorMode>("outcome");
  const [selected, setSelected] = useState<string | null>(null);
  // The map starts still; the turn is opt-in, and never offered under reduced motion.
  const [spinning, setSpinning] = useState(false);
  const [hover, setHover] = useState<PlateHover | null>(null);

  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
  const order = useMemo(
    () => meta?.conditions ?? file.stats.by_condition.map((c) => c.label),
    [meta, file],
  );
  const bounds = useMemo(() => yearBounds(file.trials), [file]);
  const visible = useCallback((t: ExplorerTrial) => matches(t, filters, bounds), [filters, bounds]);
  const color = useCallback((t: ExplorerTrial) => colorFor(t, mode, palette, order), [mode, palette, order]);
  const shown = useMemo(() => file.trials.filter(visible), [file, visible]);
  const total = file.trials.length;
  const conditions = useMemo(() => {
    const all = allFilters(file).conditions;
    const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
    return [...all].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [file, order]);
  // Announced only once typing or toggling pauses, so a screen reader is not read every keystroke.
  const announced = useSettled(summary(shown), 500);
  const selectedTrial = useMemo(
    () => (selected === null ? null : (file.trials.find((t) => t.nct_id === selected) ?? null)),
    [file, selected],
  );
  // A trial the filters have just hidden loses its card at once (the canvas then lets go of it too).
  const hoverTrial = useMemo(() => {
    const t = hover === null ? undefined : file.trials.find((x) => x.nct_id === hover.nct);
    return t !== undefined && visible(t) ? t : null;
  }, [file, hover, visible]);
  const reset = () => setFilters(allFilters(file));

  return (
    <div className="explore">
      <Title area={meta?.area ?? null} />
      <Toolbar
        trials={file.trials}
        filters={filters}
        onFilters={setFilters}
        bounds={bounds}
        conditions={conditions}
        order={order}
        mode={mode}
        onMode={setMode}
        palette={palette}
        shown={shown.length}
        onFind={() => {
          if (filters.query.trim() !== "" && shown.length > 0) setSelected(shown[0].nct_id);
        }}
        onReset={reset}
      />
      <div className="plate">
        <section className="panel panel-a" aria-labelledby="panel-a-h">
          <h2 className="panel-h" id="panel-a-h">
            <span className="panel-l">a</span>
            Embedding of {total.toLocaleString("en-US")} trials ({featureWords(file.method.features)})
          </h2>
          <ColourKey trials={file.trials} conditions={conditions} order={order} mode={mode} palette={palette} />
          <div className="panel-a-body">
            <PlateCanvas
              trials={file.trials}
              visible={visible}
              color={color}
              emphasis={mode === "outcome" ? isSucceeded : undefined}
              hollow={mode === "outcome" ? isUnknownOutcome : undefined}
              labels={order}
              selected={selected}
              onSelect={setSelected}
              reducedMotion={reducedMotion}
              spinning={spinning}
              onHover={setHover}
              ringColor={palette.stopped}
            />
            {!reducedMotion && total > 0 && (
              <SpinToggle spinning={spinning} onToggle={() => setSpinning((on) => !on)} />
            )}
            {hover && hoverTrial && <HoverCard trial={hoverTrial} x={hover.x} y={hover.y} />}
            {total === 0 ? (
              <div className="plate-empty" role="status">
                <p>The map needs at least 4 trials in this area.</p>
              </div>
            ) : shown.length === 0 ? (
              <div className="plate-empty" role="status">
                <p>No trials match these filters.</p>
                <button type="button" onClick={reset}>
                  Reset filters
                </button>
              </div>
            ) : null}
          </div>
          <p className="panel-note plate-caption">
            Dot size: enrollment. Position uses only what a trial studies; outcome is colour only.{" "}
            {coarse ? "Drag to turn, tap to open." : "Drag to turn, hover for details, click to open."}
          </p>
          <p className="visually-hidden" aria-live="polite">
            {announced}
          </p>
        </section>
        <PanelSuccess stats={file.stats} k={file.method.k} />
        <PanelPhase trials={shown} />
      </div>
      <LegendBar>
        <SelectedTrial trial={selectedTrial} />
      </LegendBar>
      <SelectedBar trial={selectedTrial} />
    </div>
  );
}
