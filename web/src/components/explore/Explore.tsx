import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { loadExplorer, loadMeta } from "../../data";
import {
  allFilters,
  colorFor,
  DARK_PALETTE,
  LIGHT_PALETTE,
  matches,
  type ColorMode,
  type Filters,
} from "../../lib/explorer";
import type { ExplorerFile, ExplorerTrial, Meta } from "../../types";
import { LegendBar } from "./LegendBar";
import { PanelPhase } from "./PanelPhase";
import { PanelSuccess } from "./PanelSuccess";
import { PlateCanvas } from "./PlateCanvas";
import { SelectedTrial } from "./SelectedTrial";
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

/** One sentence for screen readers describing what the map currently shows. */
function summary(shown: ExplorerTrial[]): string {
  const n = (o: ExplorerTrial["outcome"]) => shown.filter((t) => t.outcome === o).length;
  return (
    `${shown.length} trials; ${n("succeeded")} succeeded, ${n("stopped")} stopped early, ` +
    `${n("running")} still running, ${n("completed_unknown")} finished without a known result.`
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
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [filters, setFilters] = useState<Filters>(() => allFilters(file));
  const [mode, setMode] = useState<ColorMode>("outcome");
  const [selected, setSelected] = useState<string | null>(null);

  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
  const order = useMemo(
    () => meta?.conditions ?? file.stats.by_condition.map((c) => c.label),
    [meta, file],
  );
  const visible = useCallback((t: ExplorerTrial) => matches(t, filters), [filters]);
  const color = useCallback((t: ExplorerTrial) => colorFor(t, mode, palette, order), [mode, palette, order]);
  const shown = useMemo(() => file.trials.filter(visible), [file, visible]);
  const total = file.trials.length;
  const conditions = useMemo(() => {
    const all = allFilters(file).conditions;
    const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
    return [...all].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [file, order]);
  const selectedTrial = useMemo(
    () => (selected === null ? null : (file.trials.find((t) => t.nct_id === selected) ?? null)),
    [file, selected],
  );

  return (
    <div className="explore">
      <Title area={meta?.area ?? null} />
      <div className="plate">
        <section className="panel panel-a" aria-labelledby="panel-a-h">
          <h2 className="panel-h" id="panel-a-h">
            <span className="panel-l">a</span>
            Embedding of {total.toLocaleString("en-US")} trials ({featureWords(file.method.features)})
          </h2>
          <div className="panel-a-body">
            <PlateCanvas
              trials={file.trials}
              visible={visible}
              color={color}
              selected={selected}
              onSelect={setSelected}
              reducedMotion={reducedMotion}
              ringColor={palette.stopped}
            />
            {shown.length === 0 ? (
              <div className="plate-empty" role="status">
                <p>No trials match these filters.</p>
                <button type="button" onClick={() => setFilters(allFilters(file))}>
                  Reset filters
                </button>
              </div>
            ) : null}
          </div>
          <p className="visually-hidden" aria-live="polite">
            {summary(shown)}
          </p>
        </section>
        <PanelSuccess stats={file.stats} />
        <PanelPhase trials={shown} />
      </div>
      <LegendBar
        trials={file.trials}
        filters={filters}
        onFilters={setFilters}
        conditions={conditions}
        order={order}
        mode={mode}
        onMode={setMode}
        palette={palette}
        shown={shown.length}
        onFind={() => shown.length > 0 && setSelected(shown[0].nct_id)}
      >
        <SelectedTrial trial={selectedTrial} />
      </LegendBar>
    </div>
  );
}
