import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadGraph } from "../../data";
import { normKey } from "../../lib/pipeline";
import type { GraphFile, GraphNode, PipelineFile, PipelineMark, PipelineRow } from "../../types";

const DRUGS_IN_PILL = 4;

type Graph = { s: "loading" } | { s: "ready"; g: GraphFile | null };

/** mechanisms.json is read only here, and only when the page is opened. */
function useGraph(): Graph {
  const [g, setG] = useState<Graph>({ s: "loading" });
  useEffect(() => {
    let live = true;
    loadGraph()
      .then((x) => live && setG({ s: "ready", g: x }))
      .catch(() => live && setG({ s: "ready", g: null }));
    return () => {
      live = false;
    };
  }, []);
  return g;
}

const SOURCE: Record<string, string> = { reactome: "Reactome", go: "Gene Ontology", curated: "Curated" };

/** The gene's most specific pathway (most trials, then name) and the top-level pathway above it. */
function pathways(g: GraphFile, gene: string): { node: GraphNode | null; pills: GraphNode[] } {
  const id = `target:${gene}`;
  const node = g.nodes.find((n) => n.id === id) ?? null;
  if (!node) return { node: null, pills: [] };
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const direct = g.edges
    .filter((e) => e.kind === "in_pathway" && e.source === id)
    .map((e) => byId.get(e.target))
    .filter((n): n is GraphNode => n !== undefined)
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.label.localeCompare(b.label));
  const first = direct[0];
  if (!first) return { node, pills: [] };
  let top = first;
  const seen = new Set([first.id]);
  while (!top.top_level) {
    const up = g.edges.find((e) => e.kind === "parent" && e.source === top.id);
    const next = up ? byId.get(up.target) : undefined;
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    top = next;
  }
  return { node, pills: top.id === first.id ? [first] : [first, top] };
}

function drugsOf(marks: PipelineMark[]): { names: string[]; total: number } {
  const count = new Map<string, { name: string; n: number }>();
  for (const m of marks) {
    const k = normKey(m.drug);
    const c = count.get(k) ?? { name: m.drug, n: 0 };
    c.n++;
    count.set(k, c);
  }
  const sorted = [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { names: sorted.slice(0, DRUGS_IN_PILL).map((c) => c.name), total: sorted.length };
}

interface Props {
  file: PipelineFile;
  row: PipelineRow;
  marks: PipelineMark[];
}

/** Panel d: drug, gene, pathway, top-level pathway; the graph link only when the graph holds the gene. */
export function TargetChain({ file, row, marks }: Props) {
  const graph = useGraph();
  const { names, total } = useMemo(() => drugsOf(marks), [marks]);
  const g = graph.s === "ready" ? graph.g : null;
  const found = useMemo(() => (g && row.gene ? pathways(g, row.gene) : { node: null, pills: [] as GraphNode[] }), [g, row.gene]);
  const related = row.related.map((id) => file.rows.find((r) => r.id === id)).filter((r): r is PipelineRow => r !== undefined);
  const link = row.gene && found.node ? `/approaches/targeted?node=target:${encodeURIComponent(row.gene)}&from=${encodeURIComponent(row.id)}` : null;

  return (
    <>
      <div className="sec-h">
        <span className="ltr" aria-hidden="true">d</span>
        <h3>How it works</h3>
        {link && (
          <p>
            <Link to={link}>Open in the mechanism graph →</Link>
          </p>
        )}
      </div>
      <div className="chain" role="group" aria-label="Mechanism chain">
        <span className="nd drug">
          {names.join(", ")}
          <small>{total} {total === 1 ? "drug" : "drugs"}</small>
        </span>
        {row.gene && (
          <>
            <span className="ed" aria-hidden="true" />
            <span className="nd">
              {row.label}
              <small>gene {row.gene}</small>
            </span>
          </>
        )}
        {found.pills.map((p) => (
          <span key={p.id} style={{ display: "contents" }}>
            <span className="ed" aria-hidden="true" />
            <span className="nd">
              {p.label}
              <small>{SOURCE[p.source ?? ""] ?? "Pathway"}</small>
            </span>
          </span>
        ))}
      </div>
      {(row.blurb || related.length > 0) && (
        <p className="chain-note">
          {row.blurb}
          {related.length > 0 && (
            <>
              {row.blurb ? " " : ""}Related on the pipeline:{" "}
              {related.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && " · "}
                  <Link to={`/target/${r.id}`}>{r.label}</Link>
                </span>
              ))}
              .
            </>
          )}
        </p>
      )}
    </>
  );
}
