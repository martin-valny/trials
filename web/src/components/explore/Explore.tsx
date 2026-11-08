import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadExplorer, loadMeta } from "../../data";
import {
  allFilters,
  clusterAnchors as diseaseAnchors,
  clusterLabels,
  colorFor,
  DARK_PALETTE,
  diseaseRanking,
  diseaseSeries,
  emphasisFor,
  hollowFor,
  LIGHT_PALETTE,
  matches,
  mechanismSeries,
  splitLabel,
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
import { fitToUnit, PlateCanvas, type PlateCanvasHandle, type PlateHover } from "./PlateCanvas";
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

/**
 * Play/pause for the map's slow turn: text plus a glyph drawn in ink at a 1.5px stroke. Its name says
 * what a press will do ("Play rotation" / "Pause rotation"), so it carries no aria-pressed as well.
 */
function SpinToggle({ spinning, onToggle }: { spinning: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="plate-control spin-toggle"
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

/** Back to 1x: shown only while the map is zoomed, beside Play, with a drawn 10px frame glyph. */
function ResetView({ onReset }: { onReset: () => void }) {
  return (
    <button type="button" className="plate-control" onClick={onReset}>
      <svg className="spin-glyph" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
        <path d="M1 3.5V1h2.5M6.5 1H9v2.5M9 6.5V9H6.5M3.5 9H1V6.5" />
      </svg>
      Reset view
    </button>
  );
}

type LabelMode = "clusters" | "diseases" | "off";

/**
 * Which names the map carries: the named clusters (offered only when the file has some), each disease at
 * its densest point, or none. Quiet words beside Play, the chosen one in ink.
 */
function LabelSwitch({
  value,
  onChange,
  clusters,
}: {
  value: LabelMode;
  onChange: (m: LabelMode) => void;
  clusters: boolean;
}) {
  const modes: [LabelMode, string][] = [
    ...(clusters ? [["clusters", "Clusters"] as [LabelMode, string]] : []),
    ["diseases", "Diseases"],
    ["off", "Off"],
  ];
  return (
    <div className="label-switch" role="group" aria-label="Labels">
      <span className="label-switch-k" aria-hidden="true">
        Labels
      </span>
      {modes.map(([m, name], i) => (
        <span key={m} className="label-switch-opt">
          {i > 0 && (
            <span className="label-switch-sep" aria-hidden="true">
              ·
            </span>
          )}
          <button type="button" aria-pressed={value === m} onClick={() => onChange(m)}>
            {name}
          </button>
        </span>
      ))}
    </div>
  );
}

/** Labels off: an empty anchor list, so the canvas draws no names. */
const NO_ANCHORS: { label: string; x: number; y: number; z: number }[] = [];

/**
 * Phone key for the numerals on the map: "1 <disease> · anti-CD20 (ocrelizumab)", set like a journal figure's
 * key, the disease prefix quieter than the mechanism or type part.
 */
function ClusterKey({ labels }: { labels: string[] }) {
  return (
    <ol className="cluster-key" aria-label="Map labels">
      {labels.map((label, i) => {
        const [prefix, rest] = splitLabel(label);
        return (
          <li key={label}>
            <b className="cluster-key-n">{i + 1}</b>
            <span>
              {prefix ? <span className="cluster-key-prefix">{prefix}</span> : null}
              {rest}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

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
  const phone = useMediaQuery("(max-width: 640px)");
  const [filters, setFilters] = useState<Filters>(() => allFilters(file));
  const [mode, setMode] = useState<ColorMode>("outcome");
  // Named clusters label the map when the file has some big enough to label; otherwise each disease does.
  const hasClusters = useMemo(() => clusterLabels(file.clusters, 1).length > 0, [file]);
  const [labelMode, setLabelMode] = useState<LabelMode>(() =>
    clusterLabels(file.clusters, 1).length > 0 ? "clusters" : "diseases",
  );
  const [selected, setSelected] = useState<string | null>(null);
  // The map starts still; the turn is opt-in, and never offered under reduced motion.
  const [spinning, setSpinning] = useState(false);
  const [hover, setHover] = useState<PlateHover | null>(null);
  // Zoom lives in the canvas; React only learns whether it is past 1x, to offer Reset view.
  const [zoomed, setZoomed] = useState(false);
  const canvas = useRef<PlateCanvasHandle>(null);
  const onZoomChange = useCallback((z: number) => setZoomed(z > 1), []);
  // Zoom is not kept across a theme change. Only a change: on mount there is nothing to reset, and a
  // reset then could undo a zoom made before this effect ran.
  const lastDark = useRef(dark);
  useEffect(() => {
    if (lastDark.current === dark) return;
    lastDark.current = dark;
    canvas.current?.resetView();
  }, [dark]);

  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
  const order = useMemo(
    () => meta?.conditions ?? file.stats.by_condition.map((c) => c.label),
    [meta, file],
  );
  // Each condition keeps its own hue, dealt in the area's order; the share ranking only decides which
  // trials are redrawn on top (every condition but the largest), so small conditions stay visible.
  const series = useMemo(() => diseaseSeries(file.trials, order), [file, order]);
  const ranked = useMemo(() => diseaseRanking(file.trials, order), [file, order]);
  const bounds = useMemo(() => yearBounds(file.trials), [file]);
  // The six commonest mechanism classes over the whole file take the colour series.
  const mechanisms = useMemo(() => mechanismSeries(file.trials), [file]);
  // The largest named clusters only (8 side by side, 6 on a phone), so the labels never crowd the cloud.
  const clusterAnchors = useMemo(() => clusterLabels(file.clusters, phone ? 6 : 8), [file, phone]);
  // The names the map carries now, in the canvas's order: what the phone key numbers.
  const diseaseNames = useMemo(
    () => (phone ? diseaseAnchors(file.trials, fitToUnit(file.trials), order).map((a) => a.label) : []),
    [file, order, phone],
  );
  const mapNames =
    labelMode === "clusters" ? clusterAnchors.map((a) => a.label) : labelMode === "diseases" ? diseaseNames : [];
  // A list of trials handed over by another page (Mechanisms: "Show these trials on the map"), as
  // ?nct=NCT1,NCT2&from=<what they are>. It narrows the map on top of the filters until cleared.
  const [params, setParams] = useSearchParams();
  const only = useMemo(() => {
    const v = params.get("nct");
    return v ? new Set(v.split(",").filter(Boolean)) : null;
  }, [params]);
  const onlyN = useMemo(() => (only === null ? 0 : file.trials.filter((t) => only.has(t.nct_id)).length), [file, only]);
  const onlyFrom = params.get("from");
  const visible = useCallback(
    (t: ExplorerTrial) => (only === null || only.has(t.nct_id)) && matches(t, filters, bounds),
    [only, filters, bounds],
  );
  const color = useCallback(
    (t: ExplorerTrial) => colorFor(t, mode, palette, series, mechanisms),
    [mode, palette, series, mechanisms],
  );
  const emphasis = useMemo(() => emphasisFor(mode, ranked, mechanisms), [mode, ranked, mechanisms]);
  const hollow = useMemo(() => hollowFor(mode), [mode]);
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
  const clearOnly = () => setParams({}, { replace: true });
  const reset = () => {
    setFilters(allFilters(file));
    if (only !== null) clearOnly();
  };

  return (
    <div className="explore">
      <Title area={meta?.area ?? null} />
      <Toolbar
        trials={file.trials}
        filters={filters}
        onFilters={setFilters}
        bounds={bounds}
        conditions={conditions}
        series={series}
        mechanismSeries={mechanisms}
        approaches={file.approaches}
        mode={mode}
        onMode={setMode}
        palette={palette}
        shown={shown.length}
        onFind={() => {
          if (filters.query.trim() !== "" && shown.length > 0) setSelected(shown[0].nct_id);
        }}
        onReset={reset}
      />
      {only !== null ? (
        <p className="explore-only" role="status" aria-label="Trial list">
          Only the {onlyN.toLocaleString("en-US")} {onlyN === 1 ? "trial" : "trials"}
          {onlyFrom ? ` of ${onlyFrom}` : " listed"}.{" "}
          <button type="button" className="text-button" onClick={clearOnly}>
            Show all trials
          </button>
        </p>
      ) : null}
      <div className="plate">
        <section className="panel panel-a" aria-labelledby="panel-a-h">
          <h2 className="panel-h" id="panel-a-h">
            <span className="panel-l">a</span>
            Embedding of {total.toLocaleString("en-US")} trials ({featureWords(file.method.features)})
          </h2>
          <ColourKey
            trials={file.trials}
            series={series}
            mechanismSeries={mechanisms}
            approaches={file.approaches}
            mode={mode}
            palette={palette}
          />
          {/* A phone sheet scrolls this into view above itself (see Dropdown). */}
          <div className="panel-a-body" data-sheet-reveal="">
            <PlateCanvas
              ref={canvas}
              trials={file.trials}
              visible={visible}
              color={color}
              emphasis={emphasis}
              hollow={hollow}
              labels={labelMode === "diseases" ? order : undefined}
              anchors={labelMode === "clusters" ? clusterAnchors : labelMode === "off" ? NO_ANCHORS : undefined}
              numbered={phone}
              selected={selected}
              onSelect={setSelected}
              reducedMotion={reducedMotion}
              spinning={spinning}
              onHover={setHover}
              ringColor={palette.stopped}
              onZoomChange={onZoomChange}
            />
            {total > 0 && (
              <div className="plate-controls">
                {zoomed && (
                  <ResetView
                    onReset={() => {
                      canvas.current?.resetView();
                      // The button leaves with the zoom: hand focus to the map it acted on.
                      canvas.current?.focus();
                    }}
                  />
                )}
                <LabelSwitch value={labelMode} onChange={setLabelMode} clusters={hasClusters} />
                {!reducedMotion && <SpinToggle spinning={spinning} onToggle={() => setSpinning((on) => !on)} />}
              </div>
            )}
            {hover && hoverTrial && (
              <HoverCard trial={hoverTrial} x={hover.x} y={hover.y} r={hover.r} names={file} />
            )}
            {total === 0 ? (
              <div className="plate-empty" role="status">
                <p>The map needs at least 4 trials in this area.</p>
              </div>
            ) : shown.length === 0 ? (
              <div className="plate-empty" role="status">
                <p>No trials match these filters.</p>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    // The button leaves with the empty state: hand focus to Find, as Reset all does.
                    document.getElementById("explore-find")?.focus();
                  }}
                >
                  Reset filters
                </button>
              </div>
            ) : null}
          </div>
          {phone && mapNames.length > 0 ? <ClusterKey labels={mapNames} /> : null}
          <p className="panel-note plate-caption">
            Dot size: enrollment. Position uses only what a trial studies; outcome is colour only.{" "}
            {coarse
              ? "Pinch to zoom; drag to turn, or to pan when zoomed. Tap to open."
              : "Scroll to zoom; drag to turn, or to pan when zoomed (Shift-drag turns). Hover for details, click to open."}
          </p>
          <p className="visually-hidden" aria-live="polite">
            {announced}
          </p>
        </section>
        <PanelSuccess
          stats={file.stats}
          k={file.method.k}
          trials={file.trials}
          minGroup={file.method.min_group}
          approaches={file.approaches}
          drugIndex={file.drug_index}
        />
        <PanelPhase trials={shown} />
      </div>
      <LegendBar>
        <SelectedTrial trial={selectedTrial} names={file} />
      </LegendBar>
      <SelectedBar trial={selectedTrial} names={file} />
    </div>
  );
}
