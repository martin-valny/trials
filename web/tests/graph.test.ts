import { expect, test } from "vitest";
import {
  chain,
  convergence,
  cutCaption,
  droppedDrug,
  droppedNote,
  findMatches,
  litByTrials,
  neighbours,
  nodeShare,
  restLabels,
  shareColor,
  sourceLink,
  trialsOf,
  succeededPaths,
  winningDrugs,
} from "../src/lib/graph";
import { LIGHT_PALETTE } from "../src/lib/explorer";
import type { ExplorerTrial, GraphEdge, GraphFile, GraphNode } from "../src/types";

const node = (id: string, kind: GraphNode["kind"], extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind,
  label: id.replace(/^\w+:/, ""),
  x: 0,
  y: 0,
  n: 1,
  finished: 0,
  succeeded: 0,
  stopped: 0,
  running: 0,
  conditions: [],
  ...extra,
});
const edge = (source: string, target: string, kind: GraphEdge["kind"]): GraphEdge => ({ source, target, kind });

/**
 * Two drugs on two targets. MS4A1 sits in R-A under R-MID under the top-level R-TOP; S1PR1 sits in R-C
 * under the top-level R-TOP2; R-A and R-C share genes; cladribine acts on a class node with no pathway.
 */
const G: GraphFile = {
  generated_for: "2026-11-08",
  reactome_release: "98",
  method: { max_nodes: 250, overlap_floor: 0.3, overlap_top_k: 3, seed: 42 },
  nodes: [
    node("drug:ocrelizumab", "drug", { trials: ["NCT01", "NCT02"], n: 2, finished: 12, succeeded: 3 }),
    node("drug:fingolimod", "drug", { trials: ["NCT02", "NCT03"], n: 2 }),
    node("drug:cladribine", "drug", { trials: ["NCT04"] }),
    node("target:MS4A1", "target", { n: 2 }),
    node("target:S1PR1", "target", { n: 2 }),
    node("class:DNA inhibitor", "target"),
    node("R-A", "pathway", { source: "reactome", top_level: false, finished: 12, succeeded: 3 }),
    node("R-MID", "pathway", { source: "reactome", top_level: false, finished: 12, succeeded: 2 }),
    node("R-TOP", "pathway", { source: "reactome", top_level: true, finished: 20, succeeded: 10 }),
    node("R-C", "pathway", { source: "reactome", top_level: false, finished: 4, succeeded: 4 }),
    node("R-TOP2", "pathway", { source: "reactome", top_level: true, finished: 4, succeeded: 4 }),
  ],
  edges: [
    edge("drug:ocrelizumab", "target:MS4A1", "acts_on"),
    edge("drug:fingolimod", "target:S1PR1", "acts_on"),
    edge("drug:cladribine", "class:DNA inhibitor", "acts_on"),
    edge("target:MS4A1", "R-A", "in_pathway"),
    edge("target:S1PR1", "R-C", "in_pathway"),
    edge("R-A", "R-MID", "parent"),
    edge("R-MID", "R-TOP", "parent"),
    edge("R-C", "R-TOP2", "parent"),
    edge("R-A", "R-C", "shares_genes"),
  ],
};

test("neighbours are one hop over any edge kind, with the node itself", () => {
  expect(neighbours(G, "R-A")).toEqual(new Set(["R-A", "target:MS4A1", "R-MID", "R-C"]));
  expect(neighbours(G, "unknown")).toEqual(new Set());
});

test("chain from a drug reaches its targets, pathways and ancestors but not shares_genes neighbours", () => {
  expect(chain(G, "drug:ocrelizumab")).toEqual(
    new Set(["drug:ocrelizumab", "target:MS4A1", "R-A", "R-MID", "R-TOP"]),
  );
  expect(chain(G, "drug:ocrelizumab").has("R-C")).toBe(false);
});

test("chain from a pathway reaches every target and drug below it and its ancestors, not its siblings", () => {
  expect(chain(G, "R-MID")).toEqual(new Set(["R-MID", "R-TOP", "R-A", "target:MS4A1", "drug:ocrelizumab"]));
  // The shared target S1PR1 is not lit from MS4A1's side: no downstream after going up.
  expect(chain(G, "target:MS4A1").has("drug:fingolimod")).toBe(false);
});

test("litByTrials", () => {
  expect(litByTrials(G, new Set(["NCT03"]))).toEqual(new Set(["drug:fingolimod", "target:S1PR1", "R-C", "R-TOP2"]));
  // NCT02 tests both drugs: both chains light.
  expect(litByTrials(G, new Set(["NCT02"])).size).toBe(9);
  expect(litByTrials(G, new Set())).toEqual(new Set());
});

test("trialsOf collects the trials of every drug that reaches a node", () => {
  expect(trialsOf(G, "R-TOP")).toEqual(["NCT01", "NCT02"]);
  expect(trialsOf(G, "drug:fingolimod")).toEqual(["NCT02", "NCT03"]);
  expect(trialsOf(G, "class:DNA inhibitor")).toEqual(["NCT04"]);
});

test("trialsOf adds the trials that reach the node only through drugs the cap left out", () => {
  const g: GraphFile = {
    ...G,
    nodes: G.nodes.map((n) =>
      n.id === "target:MS4A1"
        ? { ...n, extra_trials: ["NCT09"] }
        : n.id === "R-MID"
          ? { ...n, extra_trials: ["NCT03", "NCT09"] }
          : n,
    ),
  };
  expect(trialsOf(g, "target:MS4A1")).toEqual(["NCT01", "NCT02", "NCT09"]);
  expect(trialsOf(g, "R-MID")).toEqual(["NCT01", "NCT02", "NCT03", "NCT09"]);
  // R-TOP lists its own extras only (the file gives each node its full set)
  expect(trialsOf(g, "R-TOP")).toEqual(["NCT01", "NCT02"]);
  expect(trialsOf(g, "drug:ocrelizumab")).toEqual(["NCT01", "NCT02"]);
});

test("litByTrials lights a node reached by a trial of a drug the cap left out, and its chain downstream", () => {
  const g: GraphFile = {
    ...G,
    nodes: G.nodes.map((n) => (n.id === "target:MS4A1" ? { ...n, extra_trials: ["NCT09"] } : n)),
  };
  expect(litByTrials(g, new Set(["NCT09"]))).toEqual(new Set(["target:MS4A1", "R-A", "R-MID", "R-TOP"]));
});

test("nodeShare null under minGroup", () => {
  const byId = new Map(G.nodes.map((n) => [n.id, n]));
  expect(nodeShare(byId.get("R-A")!, 10)).toBeCloseTo(0.25);
  expect(nodeShare(byId.get("R-C")!, 10)).toBeNull();
  expect(nodeShare(byId.get("target:MS4A1")!, 0)).toBeNull(); // none finished
});

test("convergence skips top-level pathways", () => {
  const ranked = convergence(G, new Set(["NCT01", "NCT02", "NCT03"]), 10).map((n) => n.id);
  // R-TOP (50%) is the best share but is top-level; R-C is under min_group.
  expect(ranked).toEqual(["R-A", "R-MID"]);
  expect(convergence(G, new Set(["NCT03"]), 10)).toEqual([]);
});

test("winningDrugs credits only the drugs that moved on (1b)", () => {
  const t = (outcome: ExplorerTrial["outcome"], succeeded_by: string[]) => ({ outcome, succeeded_by }) as ExplorerTrial;
  expect(winningDrugs([t("succeeded", ["fingolimod"]), t("stopped", ["ocrelizumab"])])).toEqual(
    new Set(["drug:fingolimod"]),
  );
});

test("sourceLink names Reactome, GO and curated sources", () => {
  expect(sourceLink(node("R-HSA-1", "pathway", { source: "reactome" }))).toEqual({
    label: "Reactome",
    url: "https://reactome.org/content/detail/R-HSA-1",
  });
  expect(sourceLink(node("GO:0002416", "pathway", { source: "go" }))).toEqual({
    label: "Gene Ontology",
    url: "https://www.ebi.ac.uk/QuickGO/term/GO:0002416",
  });
  expect(
    sourceLink(node("curated:x", "pathway", { source: "curated", source_url: "https://example.org/x" })),
  ).toEqual({ label: "curated", url: "https://example.org/x" });
  expect(sourceLink(node("target:MS4A1", "target"))).toBeNull();
});

test("shareColor runs from the pale ground (noClass) to the success red", () => {
  expect(shareColor(0, 0.5, LIGHT_PALETTE)).toBe(LIGHT_PALETTE.noClass);
  expect(shareColor(0.5, 0.5, LIGHT_PALETTE).toLowerCase()).toBe(LIGHT_PALETTE.succeeded.toLowerCase());
});

const CUT: NonNullable<GraphFile["cut"]> = {
  drugs: { before: 515, after: 66 },
  targets: { before: 472, after: 137 },
  pathways: { before: 795, after: 97 },
  min_trials: 4,
  all_succeeded: true,
  dropped: [
    { drug: "abatacept", n: 3, trials: ["NCT11", "NCT12", "NCT13"] },
    { drug: "ocrelizumab biosimilar", n: 1, trials: ["NCT14"] },
  ],
};

test("cutCaption says how many drugs are drawn and by what rule", () => {
  expect(cutCaption({ ...G, cut: CUT })).toBe(
    "Showing 66 of 515 drugs: every drug credited with a success and those in 4 or more trials.",
  );
  expect(cutCaption({ ...G, cut: { ...CUT, min_trials: null } })).toBe(
    "Showing 66 of 515 drugs: every drug credited with a success.",
  );
  expect(cutCaption({ ...G, cut: { ...CUT, all_succeeded: false, min_trials: null } })).toBe(
    "Showing 66 of 515 drugs: only drugs credited with a success, those in the most trials first.",
  );
  // Nothing left out, or an older file without the cut (R19): no caption.
  expect(cutCaption({ ...G, cut: { ...CUT, drugs: { before: 66, after: 66 }, dropped: [] } })).toBeNull();
  expect(cutCaption(G)).toBeNull();
});

test("a dropped drug is found by name and its note says why it is not drawn", () => {
  const g = { ...G, cut: CUT };
  expect(droppedDrug(g, "drug:abatacept")).toEqual(CUT.dropped[0]);
  expect(droppedDrug(g, "drug:ocrelizumab")).toBeNull();
  expect(droppedDrug(G, "drug:abatacept")).toBeNull();
  expect(droppedNote(g, CUT.dropped[0])).toBe(
    "abatacept is not drawn: it is in 3 trials, and the graph shows every drug credited with a success and those in 4 or more trials.",
  );
  expect(droppedNote(g, CUT.dropped[1])).toMatch(/^ocrelizumab biosimilar is not drawn: it is in 1 trial,/);
});

test("findMatches searches drawn nodes and dropped drugs", () => {
  const g = { ...G, cut: CUT };
  const ids = (q: string) => findMatches(g, q).map((m) => (m.dropped ? `dropped:${m.dropped.drug}` : m.node!.id));
  // Prefix matches first, then drawn before dropped, then by trials.
  expect(ids("ocre")).toEqual(["drug:ocrelizumab", "dropped:ocrelizumab biosimilar"]);
  expect(ids("abat")).toEqual(["dropped:abatacept"]);
  expect(ids("  ")).toEqual([]);
  expect(findMatches(G, "abat")).toEqual([]);
});

test("succeeded paths under a Disease filter follow succeeded_in (R21)", () => {
  const t = {
    nct_id: "NCT01",
    outcome: "succeeded",
    succeeded_by: ["fingolimod"],
    succeeded_in: ["Multiple sclerosis"],
    condition_labels: ["Multiple sclerosis", "Myasthenia gravis"],
  } as unknown as ExplorerTrial;
  expect(winningDrugs([t], new Set(["Myasthenia gravis"]))).toEqual(new Set());
  expect(winningDrugs([t], new Set(["Multiple sclerosis"]))).toEqual(new Set(["drug:fingolimod"]));
  expect(winningDrugs([t], null)).toEqual(new Set(["drug:fingolimod"]));
  expect(succeededPaths(G, [t], new Set(["Myasthenia gravis"]))).toEqual(new Set());
  expect(succeededPaths(G, [t], new Set(["Multiple sclerosis"]))).toEqual(
    new Set(["drug:fingolimod", "target:S1PR1", "R-C", "R-TOP2"]),
  );
  // An older file without succeeded_in on a succeeded trial keeps the trial's own success.
  const old = { ...t, succeeded_in: [] } as unknown as ExplorerTrial;
  expect(winningDrugs([old], new Set(["Myasthenia gravis"]))).toEqual(new Set(["drug:fingolimod"]));
});

test("restLabels: the top-level pathways labelled at rest, most trials first, then by name", () => {
  const g = {
    nodes: [
      node("R-1", "pathway", { label: "Zeta", top_level: true, n: 3 }),
      node("R-2", "pathway", { label: "Alpha", top_level: true, n: 3 }),
      node("R-3", "pathway", { label: "Big", top_level: true, n: 9 }),
      node("R-4", "pathway", { label: "Child", n: 20 }),
      node("drug:x", "drug", { n: 30 }),
    ],
    edges: [],
  } as unknown as GraphFile;
  expect(restLabels(g).map((n) => n.label)).toEqual(["Big", "Alpha", "Zeta"]);
});
