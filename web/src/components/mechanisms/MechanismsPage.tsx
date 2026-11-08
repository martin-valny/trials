import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { loadExplorer, loadGraph, loadMeta } from "../../data";
import { isApproachKey, kindTree, railRows, uncategorised } from "../../lib/approaches";
import { rowForGene } from "../../lib/pipeline";
import { useDiseaseParam, usePipelineFile } from "../../lib/useDisease";
import { UNCLASSIFIED } from "../../lib/explorer";
import {
  convergence,
  cutCaption,
  droppedDrug,
  droppedNote,
  litByTrials,
  nodeShare,
  restLabels,
  succeededPaths,
  trialsOf,
} from "../../lib/graph";
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
import { useMediaQuery } from "../../lib/useMediaQuery";
import type { ExplorerFile, ExplorerTrial, GraphFile, Meta, Outcome } from "../../types";
import { MultiSelect, type MultiSelectOption } from "../explore/MultiSelect";
import { ApproachRail } from "./ApproachRail";
import { GraphCanvas, GraphSearch } from "./GraphCanvas";
import { KindTree, STRIP_ORDER, trialsWord } from "./KindTree";
import { mapLink, NodePanel, SidePanel } from "./SidePanel";
import "../explore/explore.css";
import "./mechanisms.css";

const DEFAULT_APPROACH = "targeted";
const fmt = (n: number): string => n.toLocaleString("en-US");

type State =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error" }
  | { state: "ready"; file: ExplorerFile; meta: Meta | null };

/** mechanisms.json: undefined while loading, null when missing or unreadable (the graph waits for an update). */
type GraphState = GraphFile | null | undefined;

function Title() {
  return (
    <h1 className="plate-title">
      <b>Figure 2 |</b> Approaches: every trial by how its treatment works, from drugs with a molecular target to
      the approaches without one.
    </h1>
  );
}

/** Route ``/approaches/:approach``: an unknown approach goes to Targeted drugs. */
export function MechanismsPage() {
  const { approach } = useParams();
  const [s, setS] = useState<State>({ state: "loading" });
  const [graph, setGraph] = useState<GraphState>(undefined);

  useEffect(() => {
    let alive = true;
    Promise.all([loadExplorer(), loadMeta().catch(() => null)])
      .then(([file, meta]) => {
        if (alive) setS(file ? { state: "ready", file, meta } : { state: "missing" });
      })
      .catch(() => alive && setS({ state: "error" }));
    // The graph loads on its own: a missing or broken file leaves the rest of the page working (R19).
    loadGraph()
      .then((g) => alive && setGraph(g && Array.isArray(g.nodes) && Array.isArray(g.edges) ? g : null))
      .catch(() => alive && setGraph(null));
    return () => {
      alive = false;
    };
  }, []);

  // The old Unclassified deep link: what it held is listed on Methods now.
  if (approach === UNCLASSIFIED) return <Navigate to="/methods#not-yet-categorised" replace />;
  if (!isApproachKey(approach)) return <Navigate to={`/approaches/${DEFAULT_APPROACH}`} replace />;
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
  return <Plate file={s.file} meta={s.meta} approach={approach} graph={graph} />;
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
function StripKey({ palette, successDefined }: { palette: Palette; successDefined: boolean }) {
  const words: Record<Outcome, string> = {
    succeeded: "Advanced to next phase",
    stopped: "Stopped early",
    completed_unknown: "Finished, no follow-on",
    running: "Still running",
    unknown: "Status unknown",
  };
  return (
    <ul className="key-list strip-key" aria-label="Outcome strip key">
      {/* Non-drug care has no success rule, so no red and no Succeeded entry. */}
      {STRIP_ORDER.filter((o) => successDefined || o !== "succeeded").map((o) => (
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

function Plate({
  file,
  meta,
  approach,
  graph,
}: {
  file: ExplorerFile;
  meta: Meta | null;
  approach: string;
  graph: GraphState;
}) {
  const dark = useTheme().theme === "dark";
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kindKey = params.get("kind");
  const nodeKey = params.get("node");
  const [filters, setFilters] = useState<Filters>(() => allFilters(file));
  const pipeline = usePipelineFile();
  const bounds = useMemo(() => yearBounds(file.trials), [file]);
  const minGroup = file.method.min_group;
  const order = useMemo(() => meta?.conditions ?? file.stats.by_condition.map((c) => c.label), [meta, file]);
  const conditions = useMemo(() => {
    const all = allFilters(file).conditions;
    const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
    return [...all].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [file, order]);
  const allConditions = useMemo(() => allFilters(file).conditions, [file]);
  const disease = useDiseaseParam(pipeline, params, setParams, filters, setFilters, allConditions);
  const pristine = useMemo(() => sameFilters(filters, allFilters(file)), [filters, file]);
  // The diseases chosen, or null when the Disease filter is not narrowed (succeeded paths follow R21).
  const diseases = useMemo(() => {
    const all = allFilters(file).conditions;
    const same = all.size === filters.conditions.size && [...all].every((c) => filters.conditions.has(c));
    return same ? null : filters.conditions;
  }, [filters, file]);

  const shown = useMemo(() => file.trials.filter((t) => matches(t, filters, bounds)), [file, filters, bounds]);
  const rows = useMemo(() => railRows(shown, file, minGroup), [shown, file, minGroup]);
  const row = rows.find((r) => r.key === approach) ?? null;
  // Not yet categorised is a footnote under the rail, not a row.
  const railed = useMemo(() => rows.filter((r) => r.key !== UNCLASSIFIED), [rows]);
  const notYet = useMemo(() => uncategorised(shown), [shown]);
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

  const choose = (key: string) => navigate(`/approaches/${key}`);
  // The query keeps what other pages put there (disease, from) while one thing is opened or closed.
  const withParam = (name: string, value: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === null) next.delete(name);
        else next.set(name, value);
        return next;
      },
      { replace: true },
    );
  const openKind = (key: string) => withParam("kind", key === kindKey ? null : key);
  const closeKind = () => {
    const key = kindKey;
    withParam("kind", null);
    if (key !== null) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`.kind-row[data-kind="${CSS.escape(key)}"]`)?.focus(),
      );
    }
  };
  const reset = () => setFilters(allFilters(file));

  // The graph's focused node (?node=), if the graph has it.
  const graphNode =
    approach === DEFAULT_APPROACH && graph && nodeKey !== null ? (graph.nodes.find((x) => x.id === nodeKey) ?? null) : null;
  const focusNode = (id: string | null) => withParam("node", id);
  // Arriving from a target page (?from=<row id>): the way back, while the row exists.
  const fromRow = pipeline?.rows.find((r) => r.id === params.get("from")) ?? null;
  const nodeRow = graphNode && graphNode.kind === "target" && graphNode.id.startsWith("target:") && pipeline
    ? rowForGene(pipeline, graphNode.id.slice("target:".length))
    : null;
  const search = disease ? `?disease=${disease}` : "";
  const closeNode = () => {
    focusNode(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".graph-canvas")?.focus({ preventScroll: true }));
  };
  const nodeTrials = useMemo(() => {
    if (!graph || !graphNode) return [];
    const shownIds = new Set(shown.map((t) => t.nct_id));
    return trialsOf(graph, graphNode.id)
      .filter((nct) => shownIds.has(nct))
      .map((nct) => byNct.get(nct))
      .filter((t): t is ExplorerTrial => t !== undefined);
  }, [graph, graphNode, shown, byNct]);

  const label = row?.label ?? approach;
  const n = row?.n ?? 0;
  const narrowed = !pristine;

  return (
    <div className={selected || graphNode ? "explore mechanisms has-panel" : "explore mechanisms"}>
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
        <ApproachRail rows={railed} selected={approach} minGroup={minGroup} onSelect={choose} uncategorised={notYet} />
        <section className="mech-canvas" aria-labelledby="canvas-h" data-sheet-reveal="">
          <h2 className="panel-h" id="canvas-h">
            <span className="panel-l">b</span>
            {label}
            <span className="canvas-sum">
              {" · "}
              {fmt(n)} {n === 1 ? "trial" : "trials"}
              {row && row.successDefined && row.finished > 0
                ? ` · ${fmt(row.finished)} finished trials that count, ${fmt(row.succeeded)} advanced`
                : ""}
            </span>
          </h2>
          {approach === DEFAULT_APPROACH ? (
            <p className="panel-note graph-lede">
              {fromRow ? (
                <>
                  <Link to={`/target/${fromRow.id}${search}`}>← Back to {fromRow.label}</Link>
                  {" · "}
                </>
              ) : null}
              Targeted drugs are on the Pipeline, grouped by target. <Link className="nw" to={`/${search}`}>Open the pipeline →</Link>
            </p>
          ) : null}
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
            <GraphView
              graph={graph}
              shown={shown}
              narrowed={narrowed}
              diseases={diseases}
              disease={disease}
              minGroup={minGroup}
              palette={palette}
              focus={approach === DEFAULT_APPROACH ? nodeKey : null}
              onFocus={focusNode}
            />
          ) : (
            <>
              <StripKey palette={palette} successDefined={row?.successDefined ?? true} />
              {tree.some((g) => g.kinds.some((k) => k.elsewhere > 0)) ? (
                <p className="panel-note">
                  A trial that advanced because a drug outside the row moved on is drawn grey and read as
                  &ldquo;advanced, through another drug&rdquo;: it is counted for that drug&rsquo;s group.
                </p>
              ) : null}
              <KindTree
                groups={tree}
                selected={selected?.kind.key ?? null}
                successDefined={row?.successDefined ?? true}
                palette={palette}
                rationales={rationaleOf}
                onSelect={openKind}
              />
            </>
          )}
        </section>
        {graph && graphNode ? (
          <NodePanel
            graph={graph}
            node={graphNode}
            trials={nodeTrials}
            drugIndex={file.drug_index}
            minGroup={minGroup}
            narrowed={narrowed}
            row={nodeRow}
            pipeline={pipeline}
            disease={disease}
            onFocus={focusNode}
            onClose={closeNode}
          />
        ) : null}
        {selected ? (
          <SidePanel
            kind={selected.kind}
            group={selected.group.group}
            approach={label}
            rationale={
              selected.group.rationale ? { text: selected.group.rationale, url: selected.group.source_url } : rationaleOf(selected.kind.key)
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

/** The graph's key: what shape, fill, ring and line mean. One line, wrapping, nothing to press. */
function GraphKey({ palette, topShare }: { palette: Palette; topShare: number }) {
  const s = 10;
  const shape = (d: string, fill: string, dash?: string, inner?: boolean) => (
    <svg width={s + 2} height={s + 2} viewBox={`-1 -1 ${s + 2} ${s + 2}`} aria-hidden="true" className="key-shape">
      <path d={d} fill={fill} stroke="currentColor" strokeWidth="1" strokeDasharray={dash} />
      {inner ? <path d="M5 2.5 L7.5 5 L5 7.5 L2.5 5 Z" fill="none" stroke="currentColor" strokeWidth="1" /> : null}
    </svg>
  );
  const circle = "M10 5 A5 5 0 1 1 0 5 A5 5 0 1 1 10 5 Z";
  const square = "M0.5 0.5 H9.5 V9.5 H0.5 Z";
  const diamond = "M5 0 L10 5 L5 10 L0 5 Z";
  return (
    <ul className="key-list graph-key" aria-label="Graph key">
      <li>{shape(circle, "none")}Drug</li>
      <li>{shape(square, "none")}Target</li>
      <li>{shape(diamond, "none")}Biological pathway</li>
      <li>{shape(diamond, "none", undefined, true)}Pathway (other source)</li>
      <li>{shape(diamond, "none", "2 1.5")}Curated</li>
      <li>
        <span
          className="share-ramp"
          style={{ background: `linear-gradient(90deg, ${palette.noClass}, ${palette.succeeded})` }}
          aria-hidden="true"
        />
        Success share, 0 to {Math.round(topShare * 100)}%
      </li>
      <li>Size = number of trials</li>
    </ul>
  );
}

/**
 * Panel b for Targeted drugs: the key, the search box, the graph, a note on what the filters light,
 * and where successes converge among the trials shown.
 */
function GraphView({
  graph,
  shown,
  narrowed,
  diseases,
  disease,
  minGroup,
  palette,
  focus,
  onFocus,
}: {
  graph: GraphState;
  shown: ExplorerTrial[];
  narrowed: boolean;
  /** The diseases chosen, or null when the Disease filter is not narrowed. */
  diseases: ReadonlySet<string> | null;
  /** The one disease chosen (its code), carried in outgoing links. */
  disease: string | null;
  minGroup: number;
  palette: Palette;
  focus: string | null;
  onFocus(id: string | null): void;
}) {
  const ncts = useMemo(() => new Set(shown.map((t) => t.nct_id)), [shown]);
  const lit = useMemo(() => (graph && narrowed ? litByTrials(graph, ncts) : null), [graph, narrowed, ncts]);
  const red = useMemo(
    () => (graph && narrowed ? succeededPaths(graph, shown, diseases) : new Set<string>()),
    [graph, narrowed, shown, diseases],
  );
  const topShare = useMemo(
    () => (graph ? Math.max(0, ...graph.nodes.map((n) => nodeShare(n, minGroup) ?? 0)) : 0),
    [graph, minGroup],
  );
  const converge = useMemo(() => (graph ? convergence(graph, ncts, minGroup).slice(0, 5) : []), [graph, ncts, minGroup]);
  const reached = useMemo(() => {
    if (!graph) return 0;
    const drugTrials = new Set(graph.nodes.flatMap((n) => (n.kind === "drug" ? (n.trials ?? []) : [])));
    return shown.filter((t) => drugTrials.has(t.nct_id)).length;
  }, [graph, shown]);

  // Phone: the top-level pathways carry numerals at rest, named in a key under the canvas.
  const phone = useMediaQuery("(max-width: 640px)");
  const coarse = useMediaQuery("(pointer: coarse)");
  const keyed = useMemo(() => (graph && phone ? restLabels(graph) : []), [graph, phone]);
  const caption = graph ? cutCaption(graph) : null;
  const missing = graph && focus !== null ? droppedDrug(graph, focus) : null;

  if (graph === undefined) {
    return (
      <div className="graph-frame skeleton-block" aria-busy="true">
        <p className="visually-hidden" role="status">
          Loading the graph…
        </p>
      </div>
    );
  }
  if (graph === null || graph.nodes.length === 0) {
    return (
      <div className="canvas-empty" role="status">
        <p>The graph appears after the next update.</p>
      </div>
    );
  }
  return (
    <div className="graph-view">
      {/* The Find pill on a line of its own (right-aligned side by side), the key one line under it. */}
      <div className="graph-bar">
        <GraphSearch graph={graph} onSelect={onFocus} />
        <GraphKey palette={palette} topShare={topShare} />
      </div>
      {missing ? (
        <p className="panel-note graph-dropped" role="status" aria-label={missing.drug}>
          {droppedNote(graph, missing)}{" "}
          <Link to={mapLink(missing.trials, missing.drug, disease)}>
            Show its {trialsWord(missing.n)} on the map
          </Link>
        </p>
      ) : null}
      <div className="graph-frame">
        <GraphCanvas
          graph={graph}
          focus={missing ? null : focus}
          onFocus={onFocus}
          lit={lit}
          red={red}
          minGroup={minGroup}
          palette={palette}
          topShare={topShare}
          numbered={phone}
        />
      </div>
      {keyed.length ? (
        <ol className="cluster-key graph-label-key" aria-label="Graph labels">
          {keyed.map((n, i) => (
            <li key={n.id}>
              <b className="cluster-key-n">{i + 1}</b>
              <span>{n.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {caption ? <p className="panel-note graph-cut">{caption}</p> : null}
      <p className="panel-note graph-note">
        {narrowed
          ? `Full ink: the nodes reached by the ${trialsWord(reached)} shown; paths of trials that advanced in red, counted for the drug that advanced.`
          : `${coarse ? "Tap a node to light its neighbours and follow" : "Hover a node to light its neighbours; click to follow"} its chain from drug to pathway. Filters light up the paths their trials take.`}{" "}
        Pathways from Reactome release {graph.reactome_release}.
      </p>
      {converge.length ? (
        <section className="converge" aria-labelledby="converge-h">
          <h3 className="converge-h" id="converge-h">
            Where successes converge
          </h3>
          <ol className="converge-list">
            {converge.map(({ node: n, related }) => (
              <li key={n.id}>
                <button type="button" className="text-button node-link" onClick={() => onFocus(n.id)}>
                  {n.label}
                </button>
                <span className="converge-n">
                  {fmt(n.succeeded)} of {fmt(n.finished)} · {Math.round((nodeShare(n, minGroup) ?? 0) * 100)}%
                </span>
                {related.length ? (
                  <span className="converge-related" title={related.map((r) => r.label).join(", ")}>
                    {" "}
                    +{related.length} related {related.length === 1 ? "pathway" : "pathways"} (same trials)
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="side-muted">Pathways below the top level, ranked by success share among pool trials.</p>
        </section>
      ) : null}
    </div>
  );
}
