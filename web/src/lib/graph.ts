// The Targeted drugs graph (mechanisms.json): what lights up, what a node counts, where successes
// converge. Pure functions over the GraphFile, so the canvas and the side panel only read their results
// (spec 2026-11-06 §7.2).
import type { ExplorerTrial, GraphFile, GraphNode } from "../types";
import type { Palette } from "./explorer";

/** Edge kinds focus and filters travel along. Shared-gene links are context: drawn, never followed. */
const CHAIN_KINDS = new Set(["acts_on", "in_pathway", "parent"]);

/** A drug's node id ("drug:<name>", as the pipeline writes it). */
export const drugNodeId = (name: string): string => `drug:${name}`;

interface Adjacency {
  /** Chain edges, source -> targets (drug -> target -> pathway -> parent). */
  down: Map<string, string[]>;
  /** Chain edges, target -> sources. */
  up: Map<string, string[]>;
  /** Every edge, both directions. */
  any: Map<string, string[]>;
  ids: Set<string>;
}

const cache = new WeakMap<GraphFile, Adjacency>();

function adjacency(g: GraphFile): Adjacency {
  let a = cache.get(g);
  if (a) return a;
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  a = { down: new Map(), up: new Map(), any: new Map(), ids: new Set(g.nodes.map((n) => n.id)) };
  for (const e of g.edges) {
    push(a.any, e.source, e.target);
    push(a.any, e.target, e.source);
    if (CHAIN_KINDS.has(e.kind)) {
      push(a.down, e.source, e.target);
      push(a.up, e.target, e.source);
    }
  }
  cache.set(g, a);
  return a;
}

function walk(start: Iterable<string>, next: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of next.get(id) ?? []) if (!seen.has(n)) stack.push(n);
  }
  return seen;
}

/** The node and its one-hop neighbours over any edge kind (hover). Empty for an unknown id. */
export function neighbours(g: GraphFile, id: string): Set<string> {
  const a = adjacency(g);
  if (!a.ids.has(id)) return new Set();
  return new Set([id, ...(a.any.get(id) ?? [])]);
}

/**
 * Focus: everything downstream of the node (its targets, pathways and their ancestors) and everything
 * upstream (the pathways below it, the targets in them and the drugs acting on those), along
 * acts_on / in_pathway / parent only. Never down again after going up, so siblings stay unlit.
 */
export function chain(g: GraphFile, id: string): Set<string> {
  const a = adjacency(g);
  if (!a.ids.has(id)) return new Set();
  return new Set([...walk([id], a.down), ...walk([id], a.up)]);
}

/** The drugs' nodes and everything downstream of them. */
export function downstream(g: GraphFile, ids: Iterable<string>): Set<string> {
  const a = adjacency(g);
  return walk(
    [...ids].filter((id) => a.ids.has(id)),
    a.down,
  );
}

/** Nodes reached by the trials' drugs: each drug testing one of them, and its chain downstream. */
export function litByTrials(g: GraphFile, ncts: Set<string>): Set<string> {
  if (ncts.size === 0) return new Set();
  const drugs = g.nodes.filter((n) => n.kind === "drug" && (n.trials ?? []).some((t) => ncts.has(t)));
  return downstream(
    g,
    drugs.map((n) => n.id),
  );
}

/** Drug nodes credited with a success (1b): the drugs in a succeeded trial's ``succeeded_by``. */
export function winningDrugs(trials: ExplorerTrial[]): Set<string> {
  const out = new Set<string>();
  for (const t of trials) if (t.outcome === "succeeded") for (const d of t.succeeded_by) out.add(drugNodeId(d));
  return out;
}

/** The trials of every drug that reaches the node (the node itself, for a drug), sorted. */
export function trialsOf(g: GraphFile, id: string): string[] {
  const a = adjacency(g);
  if (!a.ids.has(id)) return [];
  const up = walk([id], a.up);
  const out = new Set<string>();
  for (const n of g.nodes) if (n.kind === "drug" && up.has(n.id)) for (const t of n.trials ?? []) out.add(t);
  return [...out].sort();
}

/** Success share among the node's pool trials (1b); null with fewer than ``minGroup`` finished, or none. */
export function nodeShare(n: GraphNode, minGroup: number): number | null {
  if (n.finished === 0 || n.finished < minGroup) return null;
  return n.succeeded / n.finished;
}

/**
 * Where successes converge: pathways reached by the trials, never top-level (every chain ends at those
 * hubs), with a defined share and at least one success; best share first, then most successes.
 */
export function convergence(g: GraphFile, ncts: Set<string>, minGroup: number): GraphNode[] {
  const lit = litByTrials(g, ncts);
  return g.nodes
    .filter((n) => n.kind === "pathway" && !n.top_level && lit.has(n.id) && n.succeeded > 0)
    .filter((n) => nodeShare(n, minGroup) !== null)
    .sort(
      (a, b) =>
        nodeShare(b, minGroup)! - nodeShare(a, minGroup)! || b.succeeded - a.succeeded || a.label.localeCompare(b.label),
    );
}

/** Where a pathway node comes from, with a link; null for drugs and targets. */
export function sourceLink(n: GraphNode): { label: string; url: string | null } | null {
  if (n.kind !== "pathway") return null;
  if (n.source === "go") return { label: "Gene Ontology", url: `https://www.ebi.ac.uk/QuickGO/term/${n.id}` };
  if (n.source === "curated") return { label: "curated", url: n.source_url ?? null };
  return { label: "Reactome", url: `https://reactome.org/content/detail/${encodeURIComponent(n.id)}` };
}

export const chemblLink = (id: string): string => `https://www.ebi.ac.uk/chembl/explore/compound/${encodeURIComponent(id)}`;

/** A class node ("class:DNA inhibitor"): a molecular class with no gene target, so no pathway. */
export const isClassNode = (n: GraphNode): boolean => n.kind === "target" && n.id.startsWith("class:");

const hex = (c: string): [number, number, number] => {
  const v = c.replace("#", "");
  const full = v.length === 3 ? [...v].map((ch) => ch + ch).join("") : v;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
};

/**
 * A node's fill: from the pale ground (no successes) to the success red at ``top``, the highest share
 * in the figure, so the scale spans the graph's own range. Shares at or above ``top`` take the full red.
 */
export function shareColor(share: number, top: number, palette: Palette): string {
  const t = top > 0 ? Math.min(1, Math.max(0, share / top)) : 0;
  if (t === 0) return palette.noClass;
  if (t === 1) return palette.succeeded;
  const [a, b] = [hex(palette.noClass), hex(palette.succeeded)];
  return (
    "#" +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
