import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TreeKind } from "../../lib/approaches";
import { outcomeLabel } from "../../lib/format";
import { chemblLink, isClassNode, nodeShare, sourceLink } from "../../lib/graph";
import { rowForGene } from "../../lib/pipeline";
import type { DrugInfo, ExplorerTrial, GraphFile, GraphNode, Outcome, PipelineFile, PipelineRow } from "../../types";
import { outcomeWords, Rationale, trialsWord } from "./KindTree";

const fmt = (n: number): string => n.toLocaleString("en-US");
/** Trials listed before "Show all": a pathway near the top can reach hundreds. */
const TRIAL_ROWS = 40;

/** The map, narrowed to these trials (Explore's ``?nct=`` list), with where they came from. */
export const mapLink = (ncts: string[], from: string, disease: string | null = null): string =>
  `/explore?${new URLSearchParams({ nct: ncts.join(","), from, ...(disease ? { disease } : {}) }).toString()}`;

/**
 * Panel c's frame: "c title" with Close, beside the canvas on wide screens and a bottom sheet on narrow
 * ones. It takes focus when ``focusKey`` changes; Escape or Close calls ``onClose``.
 */
function PanelFrame({
  title,
  focusKey,
  onClose,
  children,
}: {
  title: string;
  focusKey: string;
  onClose(): void;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [focusKey]);

  return (
    <aside
      className="side-panel"
      id="side-panel"
      aria-labelledby="side-h"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="side-head">
        <h2 className="panel-h" id="side-h" ref={heading} tabIndex={-1}>
          <span className="panel-l">c</span>
          {title}
        </h2>
        <button type="button" className="text-button side-close" onClick={onClose}>
          Close<span className="visually-hidden"> {title}</span>
        </button>
      </div>
      {children}
    </aside>
  );
}

/** Every trial with a link to its page, the first ``TRIAL_ROWS`` until "Show all". */
function TrialList({ trials }: { trials: ExplorerTrial[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? trials : trials.slice(0, TRIAL_ROWS);
  return (
    <>
      <ul className="side-trials">
        {shown.map((t) => (
          <li key={t.nct_id}>
            <Link to={`/trial/${t.nct_id}`} className="side-nct">
              {t.nct_id}
            </Link>{" "}
            <span className="side-title">{t.title}</span>
            <span className="side-outcome"> · {outcomeLabel(t.outcome)}</span>
          </li>
        ))}
      </ul>
      {shown.length < trials.length ? (
        <button type="button" className="text-button side-more" onClick={() => setAll(true)}>
          Show all {fmt(trials.length)} trials
        </button>
      ) : null}
    </>
  );
}

/**
 * A trial's outcome as this kind reads it (1b): a win credited to another drug names that drug, and in
 * Non-drug care (success not defined) a succeeded trial reads as completed.
 */
function kindOutcome(t: ExplorerTrial, kind: TreeKind, successDefined: boolean): string {
  if (t.outcome !== "succeeded") return outcomeLabel(t.outcome);
  if (!successDefined) return outcomeLabel("completed_unknown");
  if (!kind.elsewhereTrials.includes(t.nct_id)) return outcomeLabel(t.outcome);
  return t.succeeded_by.length > 0 ? `Advanced, through ${t.succeeded_by.join(", ")}` : "Advanced, through another drug";
}

/**
 * Panel c: one kind's trials. Its rationale (marked proposed, with its source), its counts, "Show these
 * trials on the map", and every trial with a link to its page. Escape or Close hands focus back to the
 * row that opened it.
 */
export function SidePanel({
  kind,
  group,
  approach,
  rationale,
  trials,
  successDefined,
  onClose,
}: {
  kind: TreeKind;
  group: string;
  approach: string;
  rationale: { text: string; url: string | null } | null;
  /** The kind's trials, in kind.trials order. */
  trials: ExplorerTrial[];
  successDefined: boolean;
  onClose(): void;
}) {
  return (
    <PanelFrame title={kind.label} focusKey={kind.key} onClose={onClose}>
      <p className="side-meta">
        {approach} › {group}
      </p>
      <p className="side-counts">
        {trialsWord(kind.n)}: {outcomeWords(kind.outcomes, kind.elsewhere)}.
        {successDefined && kind.finished > 0 ? (
          <>
            {" "}
            {fmt(kind.finished)} finished trials that count, {fmt(kind.succeeded)} advanced
            {kind.rate === null ? " (too few to tell)" : ""}.
          </>
        ) : null}
      </p>
      {rationale ? <Rationale text={rationale.text} url={rationale.url} /> : null}
      <p className="side-map">
        <Link to={mapLink(kind.trials, kind.label)}>Show these trials on the map</Link>
      </p>
      <ul className="side-trials">
        {trials.map((t) => (
          <li key={t.nct_id}>
            <Link to={`/trial/${t.nct_id}`} className="side-nct">
              {t.nct_id}
            </Link>{" "}
            <span className="side-title">{t.title}</span>
            <span className="side-outcome"> · {kindOutcome(t, kind, successDefined)}</span>
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}

const KIND_WORD: Record<GraphNode["kind"], string> = { drug: "Drug", target: "Target", pathway: "Pathway" };

/** Node links as buttons: each focuses that node on the graph (and opens its panel). */
function NodeLinks({
  nodes,
  onFocus,
  notes,
  names,
}: {
  nodes: GraphNode[];
  onFocus(id: string): void;
  notes?: Map<string, string>;
  /** Display names that replace a node's label (a protein name for a gene). */
  names?: Map<string, string>;
}) {
  return (
    <>
      {nodes.map((n, i) => (
        <span key={n.id}>
          {i > 0 ? ", " : null}
          <button type="button" className="text-button node-link" onClick={() => onFocus(n.id)}>
            {names?.get(n.id) ?? n.label}
          </button>
          {notes?.get(n.id) ? <span className="side-muted"> ({notes.get(n.id)})</span> : null}
        </span>
      ))}
    </>
  );
}

/**
 * Panel c for the graph: one node's facts (mechanism, targets or pathways, the source with its link,
 * ChEMBL for a drug), its trials by outcome among those shown, its pool share, "Show these trials on
 * the map" and the trials themselves.
 */
export function NodePanel({
  graph,
  node,
  trials,
  drugIndex,
  minGroup,
  narrowed,
  row = null,
  pipeline = null,
  disease = null,
  onFocus,
  onClose,
}: {
  graph: GraphFile;
  node: GraphNode;
  /** The node's trials that pass the filters. */
  trials: ExplorerTrial[];
  drugIndex: Record<string, DrugInfo>;
  minGroup: number;
  narrowed: boolean;
  /** The pipeline row of a target node's gene, if it has one. */
  row?: PipelineRow | null;
  /** The pipeline file, to name a gene target by its protein. */
  pipeline?: PipelineFile | null;
  /** The one disease chosen (its code), carried to the target page. */
  disease?: string | null;
  onFocus(id: string): void;
  onClose(): void;
}) {
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const out = graph.edges.filter((e) => e.source === node.id && e.kind !== "shares_genes");
  const into = graph.edges.filter((e) => e.target === node.id && e.kind !== "shares_genes");
  const nodesOf = (ids: string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => n !== undefined)
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

  const outcomes = useMemo(() => {
    const o: Record<Outcome, number> = { succeeded: 0, stopped: 0, completed_unknown: 0, running: 0, unknown: 0 };
    for (const t of trials) o[t.outcome]++;
    return o;
  }, [trials]);
  const share = nodeShare(node, minGroup);
  const source = sourceLink(node);

  const facts: [string, ReactNode][] = [];
  if (node.kind === "drug") {
    const mech = drugIndex[node.label]?.mechanisms ?? [];
    if (mech.length) facts.push(["Drug target class", mech.join(", ")]);
    const targets = nodesOf(out.map((e) => e.target));
    // "Target: CD20 (gene MS4A1)" when the pipeline names the protein; otherwise just the gene symbol.
    const names = new Map<string, string>();
    const genes = new Map<string, string>();
    for (const n of targets) {
      if (isClassNode(n) || !pipeline) continue;
      const protein = rowForGene(pipeline, n.label)?.label;
      if (protein && protein !== n.label) {
        names.set(n.id, protein);
        genes.set(n.id, `gene ${n.label}`);
      }
    }
    facts.push(["Target", <NodeLinks key="t" nodes={targets} onFocus={onFocus} notes={genes} names={names} />]);
  } else if (node.kind === "target") {
    facts.push(["Acted on by", <NodeLinks key="d" nodes={nodesOf(into.map((e) => e.source))} onFocus={onFocus} />]);
    if (isClassNode(node)) {
      facts.push(["Pathways", "no pathway: a molecular class with no gene target"]);
    } else if (out.length === 0) {
      facts.push(["Pathways", "no pathway kept for this target"]);
    } else {
      facts.push(["Pathways", <NodeLinks key="p" nodes={nodesOf(out.map((e) => e.target))} onFocus={onFocus} />]);
    }
  } else {
    const parents = out.filter((e) => e.kind === "parent").map((e) => e.target);
    const children = into.filter((e) => e.kind === "parent").map((e) => e.source);
    const targets = into.filter((e) => e.kind === "in_pathway").map((e) => e.source);
    if (parents.length) facts.push(["Part of", <NodeLinks key="up" nodes={nodesOf(parents)} onFocus={onFocus} />]);
    if (children.length) facts.push(["Contains", <NodeLinks key="down" nodes={nodesOf(children)} onFocus={onFocus} />]);
    if (targets.length) facts.push(["Targets", <NodeLinks key="tg" nodes={nodesOf(targets)} onFocus={onFocus} />]);
  }

  return (
    <PanelFrame title={node.label} focusKey={node.id} onClose={onClose}>
      <p className="side-meta">
        Targeted drugs › {KIND_WORD[node.kind]}
        {source ? <> · {source.label === "curated" ? <b>curated</b> : source.label}</> : null}
      </p>
      {node.kind === "target" && row ? (
        <p className="side-map">
          <Link to={`/target/${row.id}${disease ? `?disease=${disease}` : ""}`}>Open {row.label} page →</Link>
        </p>
      ) : null}
      {facts.length ? (
        <dl className="side-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {node.top_level ? (
        <p className="side-muted">
          A top-level pathway: drawn for orientation, never counted where successes converge.
        </p>
      ) : null}
      <p className="side-sources">
        {source?.url ? (
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.label === "curated" ? "Curated source" : `${source.label} ${node.id}`}
          </a>
        ) : null}
        {node.kind === "drug" && node.chembl_id ? (
          <a href={chemblLink(node.chembl_id)} target="_blank" rel="noreferrer">
            ChEMBL {node.chembl_id}
          </a>
        ) : null}
      </p>
      <p className="side-counts">
        {trials.length === 0 ? (
          narrowed ? (
            "No trials shown under these filters."
          ) : (
            "No trials."
          )
        ) : (
          <>
            {trialsWord(trials.length)}
            {narrowed ? " shown" : ""}: {outcomeWords(outcomes)}.
          </>
        )}{" "}
        {node.finished > 0 ? (
          <>
            Finished trials that count{narrowed ? " (all trials)" : ""}: {fmt(node.finished)}, {fmt(node.succeeded)} counted
            as advanced
            {share === null ? " (too few to tell)" : ` (${Math.round(share * 100)}%)`}.
          </>
        ) : (
          "No finished trials that count yet."
        )}
      </p>
      {trials.length ? (
        <>
          <p className="side-map">
            <Link to={mapLink(trials.map((t) => t.nct_id), node.label, disease)}>Show these trials on the map</Link>
          </p>
          <TrialList key={node.id} trials={trials} />
        </>
      ) : null}
    </PanelFrame>
  );
}
