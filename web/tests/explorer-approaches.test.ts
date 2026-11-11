import { describe, expect, it } from "vitest";
import {
  allFilters,
  APPROACH_SERIES,
  approachLabel,
  approachText,
  colorFor,
  emphasisFor,
  filterCounts,
  groupsOf,
  hollowFor,
  LIGHT_PALETTE,
  matches,
  MODES,
  NONE,
  normalizeFile,
  popupLines,
  successGroups,
  wonIn,
  type DrugInfo,
} from "../src/lib/explorer";
import type { ExplorerFile, ExplorerTrial } from "../src/types";

const trial = (o: Partial<ExplorerTrial> = {}): ExplorerTrial => ({
  approaches: ["targeted"],
  cluster: null,
  condition_labels: ["Alpha"],
  drugs: ["fooumab"],
  end_estimated: false,
  end_year: 2022,
  enrollment: 10,
  has_results: false,
  in_pool: true,
  kinds: [],
  lead_sponsor: "Acme Pharma",
  mechanisms: [],
  modalities: [],
  nct_id: "NCT00000001",
  outcome: "succeeded",
  phase: "PHASE2",
  start_year: 2020,
  succeeded_by: [],
  succeeded_in: ["Alpha"],
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
  "type:DEVICE": { approach: "nondrug", group: "Devices & neuromodulation", label: "other device", rationale: "", source_url: "" },
  "type:BEHAVIORAL": {
    approach: "nondrug",
    group: "Behavioural & psychological",
    label: "other behavioural",
    rationale: "",
    source_url: "",
  },
};

const NAMES = { approaches: APPROACHES, kinds: KINDS };

const CYCLO: Record<string, DrugInfo> = {
  cyclophosphamide: {
    approaches: ["targeted"],
    kinds: [],
    mechanisms: ["alkylating agent"],
    modalities: ["small molecule"],
  },
  "ahsct-x": { approaches: ["cell"], kinds: ["ahsct"], mechanisms: [], modalities: [] },
};

describe("1b: success is credited to the drug that moved on", () => {
  // aHSCT + cyclophosphamide; the trial succeeded only because cyclophosphamide moved on.
  const t = trial({
    drugs: ["ahsct-x", "cyclophosphamide"],
    mechanisms: ["alkylating agent"],
    modalities: ["small molecule"],
    kinds: ["ahsct"],
    approaches: ["targeted", "cell"],
    succeeded_by: ["cyclophosphamide"],
  });

  it("successGroups credits only the winning drug's groups", () => {
    const byApproach = successGroups([t], "approach", 1, 8, undefined, CYCLO);
    expect(byApproach).toEqual([
      { group: "cell", finished: 1, succeeded: 0, rate: 0 },
      { group: "targeted", finished: 1, succeeded: 1, rate: 1 },
    ]);
    expect(successGroups([t], "mechanism", 1, 8, undefined, CYCLO)).toEqual([
      { group: "alkylating agent", finished: 1, succeeded: 1, rate: 1 },
    ]);
    expect(successGroups([t], "modality", 1, 8, undefined, CYCLO)).toEqual([
      { group: "small molecule", finished: 1, succeeded: 1, rate: 1 },
    ]);
  });

  it("wonIn and groupsOf read the trial's groups and the winning drug's groups", () => {
    expect(groupsOf(t, "approach")).toEqual(["targeted", "cell"]);
    expect(groupsOf(t, "mechanism")).toEqual(["alkylating agent"]);
    expect(groupsOf(t, "modality")).toEqual(["small molecule"]);
    expect(groupsOf(t, "disease")).toEqual(["Alpha"]);
    expect(wonIn(t, "approach", "targeted", CYCLO)).toBe(true);
    expect(wonIn(t, "approach", "cell", CYCLO)).toBe(false);
    // A trial that did not succeed wins nowhere, whatever its succeeded_by says.
    expect(wonIn({ ...t, outcome: "stopped" }, "approach", "targeted", CYCLO)).toBe(false);
  });

  it("a trial whose winning drug is not in the drug index wins in no group", () => {
    expect(wonIn(t, "approach", "targeted", {})).toBe(false);
  });

  it("a file without succeeded_by (older) credits the trial's own outcome, as before", () => {
    const old = trial({ mechanisms: ["PD-1"], succeeded_by: [] });
    expect(wonIn(old, "mechanism", "PD-1", {})).toBe(true);
  });

  it("disease grouping still uses succeeded_in", () => {
    const d = trial({ condition_labels: ["A", "B"], succeeded_in: ["A"], succeeded_by: ["cyclophosphamide"] });
    expect(successGroups([d], "disease", 1, 8, ["A", "B"], CYCLO)).toEqual([
      { group: "A", finished: 1, succeeded: 1, rate: 1 },
      { group: "B", finished: 1, succeeded: 0, rate: 0 },
    ]);
    expect(wonIn(d, "disease", "B", CYCLO)).toBe(false);
  });
});

describe("approach colour mode", () => {
  const L = LIGHT_PALETTE;
  const col = (approaches: string[]) => colorFor(trial({ approaches }), "approach", L, []);

  it("is offered after Modality", () => {
    expect(MODES.map(([m]) => m)).toEqual(["outcome", "phase", "disease", "mechanism", "modality", "approach"]);
    expect(MODES.find(([m]) => m === "approach")?.[1]).toBe("Approach");
  });

  it("approach colour mode colours by approach with \"multiple\" for two", () => {
    expect(APPROACH_SERIES).toEqual(["targeted", "cell", "plasma", "tolerisation", "diffuse", "nondrug"]);
    APPROACH_SERIES.forEach((a, i) => expect(col([a])).toBe(L.diseases[i]));
    expect(col(["targeted", "nondrug"])).toBe(L.multiple);
    expect(hollowFor("approach")!(trial({ approaches: ["targeted", "cell"] }))).toBe(true);
    expect(hollowFor("approach")!(trial({ approaches: ["cell"] }))).toBe(false);
  });

  it("Unclassified and no approach take the neutral fill, never red", () => {
    expect(col(["unclassified"])).toBe(L.noClass);
    expect(col([])).toBe(L.noClass);
    for (const a of [...APPROACH_SERIES, "unclassified"]) expect(col([a])).not.toBe(L.succeeded);
  });

  it("hued single approaches are drawn on top; unclassified and multiple are not", () => {
    const e = emphasisFor("approach", [])!;
    expect(e(trial({ approaches: ["cell"] }))).toBe(true);
    expect(e(trial({ approaches: ["unclassified"] }))).toBe(false);
    expect(e(trial({ approaches: ["cell", "targeted"] }))).toBe(false);
  });
});

describe("approach filter", () => {
  const f = (trials: ExplorerTrial[]) =>
    ({
      approaches: APPROACHES,
      clusters: [],
      drug_index: {},
      kinds: KINDS,
      stats: { by_condition: [] },
      trials,
    }) as unknown as ExplorerFile;

  it("allFilters selects every approach present plus none; a trial passes when any of its approaches is on", () => {
    const ts = [trial({ approaches: ["cell"] }), trial({ approaches: ["targeted", "nondrug"] }), trial({ approaches: [] })];
    const all = allFilters(f(ts));
    expect([...all.approaches].sort()).toEqual([NONE, "cell", "nondrug", "targeted"].sort());
    const B: [number, number] = [2010, 2026];
    const only = { ...all, approaches: new Set(["nondrug"]) };
    expect(ts.map((t) => matches(t, only, B))).toEqual([false, true, false]);
    const none = { ...all, approaches: new Set([NONE]) };
    expect(ts.map((t) => matches(t, none, B))).toEqual([false, false, true]);
  });

  it("filterCounts tallies each approach a trial is in", () => {
    const c = filterCounts([trial({ approaches: ["cell", "targeted"] }), trial({ approaches: ["cell"] })]);
    expect(c.approaches.get("cell")).toBe(2);
    expect(c.approaches.get("targeted")).toBe(1);
  });
});

describe("approach names", () => {
  it("approachLabel reads the file's labels, falling back to the key", () => {
    const file = { approaches: APPROACHES } as unknown as ExplorerFile;
    expect(approachLabel("cell", file)).toBe("Cell & transplant");
    expect(approachLabel("mystery", file)).toBe("mystery");
    expect(approachLabel(NONE, file)).toBe("No approach");
  });

  it("approachText names each approach with its kinds in brackets", () => {
    const t = trial({ approaches: ["targeted", "nondrug"], kinds: ["type:BEHAVIORAL", "type:DEVICE"] });
    expect(approachText(t, NAMES)).toBe("Targeted drugs; Non-drug care (other behavioural, other device)");
    expect(approachText(trial({ approaches: ["cell"], kinds: ["ahsct"] }), NAMES)).toBe("Cell & transplant (aHSCT)");
    expect(approachText(trial({ approaches: [] }), NAMES)).toBeNull();
  });

  it("the hover card's facts carry the approach and kind, shortened to the first", () => {
    const t = trial({
      drugs: ["ahsct-x"],
      approaches: ["cell", "targeted"],
      kinds: ["ahsct"],
      treatment_types: ["BIOLOGICAL"],
      start_year: 2019,
      end_year: 2021,
    });
    expect(popupLines(t, NAMES)[1]).toBe("ahsct-x · Cell & transplant (aHSCT) +1 · Biological · Phase 2 · 2019–2021");
    // Without names (no file), no approach part.
    expect(popupLines(t)[1]).toBe("ahsct-x · Biological · Phase 2 · 2019–2021");
  });
});

describe("normalizeFile: approach fields", () => {
  it("defaults the approach fields an older file lacks", () => {
    const old = { trials: [{ nct_id: "NCT1", condition_labels: [], drugs: [] }] } as unknown as ExplorerFile;
    const f = normalizeFile(old);
    expect(f.approaches).toEqual([]);
    expect(f.kinds).toEqual({});
    expect(f.drug_index).toEqual({});
    const [t] = f.trials;
    expect(t.approaches).toEqual([]);
    expect(t.kinds).toEqual([]);
    expect(t.unsorted).toEqual([]);
    expect(t.succeeded_by).toEqual([]);
  });
});
