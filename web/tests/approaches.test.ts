import { describe, expect, it } from "vitest";
import { kindTree, mechanismsLink, railRows, uncategorised, APPROACH_KEYS, isApproachKey, NOT_YET_SORTED_ELSEWHERE } from "../src/lib/approaches";
import type { ExplorerFile, ExplorerTrial } from "../src/types";

const trial = (o: Partial<ExplorerTrial> = {}): ExplorerTrial => ({
  approaches: ["targeted"],
  cluster: null,
  condition_labels: ["Alpha"],
  drugs: [],
  end_estimated: false,
  end_year: 2022,
  enrollment: 10,
  has_results: false,
  in_pool: false,
  kinds: [],
  lead_sponsor: "Acme Pharma",
  mechanisms: [],
  modalities: [],
  nct_id: "NCT00000001",
  outcome: "running",
  phase: "PHASE2",
  start_year: 2020,
  succeeded_by: [],
  succeeded_in: [],
  targets: [],
  title: "A Study of Things",
  treatment_types: ["DRUG"],
  unsorted: [],
  x: 0,
  y: 0,
  z: 0,
  ...o,
});

const APPROACHES = [
  { key: "targeted", label: "Targeted drugs" },
  { key: "cell", label: "Cell & transplant" },
  { key: "plasma", label: "Antibody & plasma" },
  { key: "tolerisation", label: "Tolerisation" },
  { key: "diffuse", label: "Broad immunomodulators" },
  { key: "nondrug", label: "Non-drug care" },
  { key: "unclassified", label: "Unclassified" },
];

const KINDS: ExplorerFile["kinds"] = {
  ahsct: {
    approach: "cell",
    group: "Haematopoietic reset",
    label: "aHSCT",
    rationale: "Proposed immune reset",
    source_url: "https://example.org/ahsct",
  },
  msc: {
    approach: "cell",
    group: "Mesenchymal cells",
    label: "Mesenchymal stem cells",
    rationale: "Proposed paracrine immunomodulation",
    source_url: "https://example.org/msc",
  },
  msc_ntf: {
    approach: "cell",
    group: "Mesenchymal cells",
    label: "MSC-NTF",
    rationale: "Proposed paracrine immunomodulation",
    source_url: "https://example.org/msc",
  },
  exercise: {
    approach: "nondrug",
    group: "Rehabilitation & exercise",
    label: "Exercise",
    rationale: "Proposed functional benefit",
    source_url: "https://example.org/exercise",
  },
  not_a_treatment: {
    approach: "unclassified",
    group: "Not a treatment",
    label: "not a treatment",
    rationale: "",
    source_url: "",
  },
  "type:OTHER": {
    approach: "unclassified",
    group: "Not yet sorted",
    label: "unmapped other",
    rationale: "",
    source_url: "",
  },
};

const file = (trials: ExplorerTrial[], o: Partial<ExplorerFile> = {}): ExplorerFile =>
  ({
    approaches: APPROACHES,
    clusters: [],
    drug_index: {
      cyclophosphamide: { mechanisms: ["alkylating agent"], modalities: [], kinds: [], approaches: ["targeted"] },
      "stem cells": { mechanisms: [], modalities: [], kinds: ["ahsct"], approaches: ["cell"] },
    },
    generated_for: "2026-11-08",
    kinds: KINDS,
    method: {} as ExplorerFile["method"],
    stats: {} as ExplorerFile["stats"],
    trials,
    ...o,
  }) as ExplorerFile;

describe("railRows", () => {
  it("railRows counts each approach once per trial and marks nondrug success undefined", () => {
    const trials = [
      trial({ nct_id: "A", approaches: ["targeted", "cell"], kinds: ["ahsct", "msc"] }),
      trial({ nct_id: "B", approaches: ["targeted"] }),
      trial({ nct_id: "C", approaches: ["targeted", "nondrug"], kinds: ["exercise"], in_pool: true }),
      trial({ nct_id: "D", approaches: ["unclassified"], kinds: [] }),
    ];
    const f = file(trials);
    const rows = railRows(trials, f, 1);
    expect(rows.map((r) => r.key)).toEqual(APPROACHES.map((a) => a.key));
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.targeted.n).toBe(3);
    expect(by.targeted.label).toBe("Targeted drugs");
    expect(by.cell.n).toBe(1); // two cell kinds, still one trial
    expect(by.nondrug.n).toBe(1);
    expect(by.nondrug.successDefined).toBe(false);
    expect(by.nondrug.rate).toBeNull();
    expect(by.targeted.successDefined).toBe(true);
    expect(by.unclassified.n).toBe(1);
    expect(by.plasma.n).toBe(0);
  });

  it("railRows applies too-few under minGroup", () => {
    const pool = (i: number, won: boolean) =>
      trial({
        nct_id: `P${i}`,
        in_pool: true,
        outcome: won ? "succeeded" : "completed_unknown",
        succeeded_by: won ? ["cyclophosphamide"] : [],
      });
    const trials = [pool(1, true), pool(2, false), pool(3, false)];
    const f = file(trials);
    const few = railRows(trials, f, 10).find((r) => r.key === "targeted")!;
    expect(few.finished).toBe(3);
    expect(few.succeeded).toBe(1);
    expect(few.rate).toBeNull();
    const enough = railRows(trials, f, 3).find((r) => r.key === "targeted")!;
    expect(enough.rate).toBeCloseTo(1 / 3);
  });

  it("is empty without approach data", () => {
    expect(railRows([trial({ approaches: [] })], file([], { approaches: [] }), 10)).toEqual([]);
  });
});

describe("kindTree", () => {
  it("kindTree groups kinds and uses 1b", () => {
    const trials = [
      // aHSCT + cyclophosphamide, succeeded because cyclophosphamide moved on: not a success for aHSCT.
      trial({
        nct_id: "A",
        approaches: ["targeted", "cell"],
        kinds: ["ahsct"],
        drugs: ["cyclophosphamide", "stem cells"],
        in_pool: true,
        outcome: "succeeded",
        succeeded_by: ["cyclophosphamide"],
      }),
      // aHSCT alone, succeeded because the stem cells moved on.
      trial({
        nct_id: "B",
        approaches: ["cell"],
        kinds: ["ahsct"],
        drugs: ["stem cells"],
        in_pool: true,
        outcome: "succeeded",
        succeeded_by: ["stem cells"],
      }),
      trial({ nct_id: "C", approaches: ["cell"], kinds: ["msc"], outcome: "stopped" }),
      trial({ nct_id: "D", approaches: ["cell"], kinds: ["msc", "msc_ntf"], outcome: "running" }),
      trial({ nct_id: "E", approaches: ["nondrug"], kinds: ["exercise"] }),
      trial({ nct_id: "F", approaches: ["cell"], kinds: ["msc"], outcome: "unknown" }),
    ];
    const tree = kindTree("cell", trials, file(trials), 1);
    expect(tree.map((g) => g.group)).toEqual(["Mesenchymal cells", "Haematopoietic reset"]);
    const [mesenchymal, reset] = tree;
    // Every kind in a group shares one rationale: the group carries it.
    expect(mesenchymal.rationale).toBe("Proposed paracrine immunomodulation");
    expect(mesenchymal.source_url).toBe("https://example.org/msc");
    expect(mesenchymal.kinds.map((k) => [k.key, k.n])).toEqual([
      ["msc", 3],
      ["msc_ntf", 1],
    ]);
    const msc = mesenchymal.kinds[0];
    expect(msc.outcomes.stopped).toBe(1);
    expect(msc.outcomes.running).toBe(1);
    expect(msc.outcomes.unknown).toBe(1);
    expect(msc.trials).toEqual(["C", "D", "F"]);
    const ahsct = reset.kinds[0];
    expect(ahsct.label).toBe("aHSCT");
    expect(ahsct.n).toBe(2);
    expect(ahsct.finished).toBe(2);
    expect(ahsct.succeeded).toBe(1); // only B: A's win belongs to cyclophosphamide
    // The strip and its words follow 1b too: A is drawn as completed, read as "succeeded via another drug".
    expect(ahsct.outcomes.succeeded).toBe(1);
    expect(ahsct.elsewhere).toBe(1);
    expect(ahsct.elsewhereTrials).toEqual(["A"]);
    expect(ahsct.rate).toBe(0.5);
  });

  it("gives no rate under minGroup", () => {
    const trials = [trial({ nct_id: "A", approaches: ["cell"], kinds: ["ahsct"], in_pool: true })];
    expect(kindTree("cell", trials, file(trials), 10)[0].kinds[0].rate).toBeNull();
  });

  it("unclassified tree lists unsorted names by count", () => {
    const trials = [
      trial({ nct_id: "A", approaches: ["unclassified"], kinds: ["type:OTHER"], unsorted: ["standard therapy"] }),
      trial({
        nct_id: "B",
        approaches: ["unclassified"],
        kinds: ["type:OTHER"],
        unsorted: ["standard therapy", "arm b"],
      }),
      trial({ nct_id: "C", approaches: ["unclassified"], kinds: ["not_a_treatment"] }),
      trial({ nct_id: "D", approaches: ["unclassified"], kinds: [], unsorted: [] }),
      // In another bubble: its unsorted name is not part of Unclassified's tree.
      trial({ nct_id: "E", approaches: ["targeted"], unsorted: ["mystery drug"] }),
    ];
    const tree = kindTree("unclassified", trials, file(trials), 10);
    expect(tree.map((g) => g.group)).toEqual([
      "Not yet sorted",
      "No experimental treatment listed",
      "Not a treatment",
      NOT_YET_SORTED_ELSEWHERE,
    ]);
    const notYet = tree[0];
    expect(notYet.kinds.map((k) => [k.label, k.n])).toEqual([
      ["standard therapy", 2],
      ["arm b", 1],
    ]);
    expect(tree[1].kinds.map((k) => [k.label, k.n])).toEqual([["no experimental treatment kept", 1]]);
    expect(notYet.kinds[0].trials).toEqual(["A", "B"]);
    expect(notYet.rationale).toBeNull();
    expect(tree[2].kinds.map((k) => [k.label, k.n])).toEqual([["not a treatment", 1]]);
  });

  it("lists unsorted names whose trials all sit in other approaches in a last group of their own", () => {
    const trials = [
      trial({ nct_id: "A", approaches: ["unclassified"], kinds: ["type:OTHER"], unsorted: ["standard therapy"] }),
      // Listed in Unclassified already (A): not repeated below.
      trial({ nct_id: "B", approaches: ["targeted"], unsorted: ["standard therapy"] }),
      // Only in other bubbles: the backlog still shows them, by trial count.
      trial({ nct_id: "C", approaches: ["targeted"], unsorted: ["ct103a cells", "2b3-201"] }),
      trial({ nct_id: "D", approaches: ["cell"], kinds: ["ahsct"], unsorted: ["ct103a cells"] }),
    ];
    const tree = kindTree("unclassified", trials, file(trials), 10);
    expect(tree.map((g) => g.group)).toEqual(["Not yet sorted", NOT_YET_SORTED_ELSEWHERE]);
    expect(tree[0].kinds.map((k) => [k.label, k.trials])).toEqual([["standard therapy", ["A"]]]);
    expect(tree[1].kinds.map((k) => [k.label, k.trials])).toEqual([
      ["ct103a cells", ["C", "D"]],
      ["2b3-201", ["C"]],
    ]);
    // Other approaches' trees never carry the backlog.
    expect(kindTree("targeted", trials, file(trials), 10)).toEqual([]);
  });

  it("never shows a success in Non-drug care: a win through a drug reads as completed", () => {
    const trials = [
      trial({
        nct_id: "A",
        approaches: ["targeted", "nondrug"],
        kinds: ["exercise"],
        drugs: ["cyclophosphamide"],
        in_pool: true,
        outcome: "succeeded",
        succeeded_by: ["cyclophosphamide"],
      }),
      trial({ nct_id: "B", approaches: ["nondrug"], kinds: ["exercise"], outcome: "running" }),
    ];
    const ex = kindTree("nondrug", trials, file(trials), 1)[0].kinds[0];
    expect(ex.outcomes.succeeded).toBe(0);
    expect(ex.outcomes.completed_unknown).toBe(1);
    expect(ex.elsewhere).toBe(0);
    expect(ex.succeeded).toBe(0);
  });

  it("a legacy trial with no succeeded_by keeps its own outcome", () => {
    const trials = [
      trial({ nct_id: "A", approaches: ["cell"], kinds: ["ahsct"], in_pool: true, outcome: "succeeded" }),
    ];
    const k = kindTree("cell", trials, file(trials), 1)[0].kinds[0];
    expect(k.outcomes.succeeded).toBe(1);
    expect(k.elsewhere).toBe(0);
  });
});

describe("approach keys", () => {
  it("knows the seven keys", () => {
    expect(APPROACH_KEYS).toHaveLength(7);
    expect(isApproachKey("cell")).toBe(true);
    expect(isApproachKey("bogus")).toBe(false);
  });
});


describe("unclassified rows that no drug can win", () => {
  it("shows a succeeded trial in the no-treatment row as completed, not 'via another drug'", () => {
    const trials = [
      trial({ nct_id: "A", approaches: ["unclassified"], kinds: [], unsorted: [], outcome: "succeeded", in_pool: true }),
    ];
    const tree = kindTree("unclassified", trials, file(trials), 1);
    const row = tree.flatMap((g) => g.kinds)[0];
    expect(row.label).toBe("no experimental treatment kept");
    expect(row.elsewhere).toBe(0);
    expect(row.outcomes.completed_unknown).toBe(1);
  });
});

describe("mechanismsLink for Not yet categorised trials", () => {
  const f = file([]);
  it("has no page to open: the Approaches rail no longer lists them", () => {
    expect(mechanismsLink(trial({ approaches: ["unclassified"], kinds: ["type:OTHER"], unsorted: ["standard therapy"] }), f)).toBeNull();
    expect(mechanismsLink(trial({ approaches: ["unclassified"], kinds: [], unsorted: [] }), f)).toBeNull();
  });
  it("counts them for the rail footnote: unsorted names, and trials that are not a treatment", () => {
    const ts = [
      trial({ nct_id: "A", approaches: ["unclassified"], unsorted: ["x", "y"] }),
      trial({ nct_id: "B", approaches: ["unclassified"], unsorted: ["x"] }),
      trial({ nct_id: "C", approaches: ["unclassified"], unsorted: [] }),
      trial({ nct_id: "D", approaches: ["cell"], unsorted: ["z"] }),
    ];
    expect(uncategorised(ts)).toEqual({ n: 3, u: 2, d: 1 });
  });
});
