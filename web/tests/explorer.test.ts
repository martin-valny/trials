import { describe, expect, it } from "vitest";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  allFilters,
  clusterAnchors,
  colorFor,
  columnLabels,
  columnSide,
  diseaseRanking,
  diseaseSeries,
  emphasisFor,
  IDENTITY_VIEW,
  panBy,
  viewPoints,
  zoomAt,
  labelPosition,
  placeLabels,
  liftSentence,
  formatP,
  filterSummary,
  isFullYears,
  matches,
  setAll,
  setNone,
  sameFilters,
  tally,
  yearBounds,
  nearestIndex,
  project,
  popupLines,
  popupPosition,
  yearSpan,
  successGroups,
  filterCounts,
  MODALITIES,
  MODES,
  NONE,
  mechanismSeries,
  clusterLabels,
  paintedClasses,
  mechanismText,
  modalityText,
} from "../src/lib/explorer";
import type { Filters } from "../src/lib/explorer";
import type { ExplorerCluster, ExplorerFile, ExplorerStats, ExplorerTrial } from "../src/types";
import { readFixture } from "./helpers";

const trial = (o: Partial<ExplorerTrial> = {}): ExplorerTrial => ({
  cluster: null,
  condition_labels: ["Alpha", "Beta"],
  drugs: ["fooumab"],
  end_estimated: false,
  end_year: 2022,
  enrollment: 10,
  has_results: false,
  in_pool: true,
  lead_sponsor: "Acme Pharma",
  mechanisms: [],
  modalities: [],
  nct_id: "NCT00000001",
  outcome: "succeeded",
  phase: "PHASE2",
  start_year: 2020,
  targets: [],
  succeeded_in: ["Alpha"],
  title: "A Study of Things",
  treatment_types: ["DRUG"],
  x: 0,
  y: 0,
  z: 0,
  ...o,
});

const B: [number, number] = [2010, 2026];

const file = (): ExplorerFile => readFixture<ExplorerFile>("explorer.json");

describe("allFilters / matches", () => {
  it("allFilters includes every trial in the fixture", () => {
    const f = file();
    const flt = allFilters(f);
    expect(f.trials.length).toBeGreaterThan(0);
    for (const t of f.trials) expect(matches(t, flt, B)).toBe(true);
  });

  const all = () => ({
    conditions: new Set(["Alpha", "Beta"]),
    phases: new Set(["PHASE2"]),
    outcomes: new Set(["succeeded" as const]),
    treatmentTypes: new Set(["DRUG"]),
    mechanisms: new Set(["anti-CD20", NONE]),
    modalities: new Set(["antibody", NONE]),
    query: "",
    resultsOnly: false,
    years: B,
  });

  it("matches with all filters on", () => expect(matches(trial(), all(), B)).toBe(true));

  it("any label on is enough; none on excludes", () => {
    expect(matches(trial(), { ...all(), conditions: new Set(["Beta"]) }, B)).toBe(true);
    expect(matches(trial(), { ...all(), conditions: new Set(["Gamma"]) }, B)).toBe(false);
  });

  it("filters phase, outcome and treatment type", () => {
    expect(matches(trial(), { ...all(), phases: new Set(["PHASE3"]) }, B)).toBe(false);
    expect(matches(trial(), { ...all(), outcomes: new Set(["stopped" as const]) }, B)).toBe(false);
    expect(matches(trial(), { ...all(), treatmentTypes: new Set(["DEVICE"]) }, B)).toBe(false);
  });

  it("null phase falls in the NA bucket", () => {
    expect(matches(trial({ phase: null }), { ...all(), phases: new Set(["NA"]) }, B)).toBe(true);
    expect(matches(trial({ phase: null }), { ...all(), phases: new Set() }, B)).toBe(false);
  });

  it("empty condition_labels or treatment_types always pass that filter", () => {
    const flt = all();
    for (const t of [trial({ condition_labels: [] }), trial({ treatment_types: [] })]) {
      expect(matches(t, flt, B)).toBe(true);
      expect(matches(t, { ...all(), conditions: new Set(["Gamma"]) }, B)).toBe(t.condition_labels.length === 0);
      expect(matches(t, { ...all(), treatmentTypes: new Set(["DEVICE"]) }, B)).toBe(t.treatment_types.length === 0);
    }
    const off = { ...flt, conditions: new Set([...flt.conditions].slice(1)) };
    expect(matches(trial({ condition_labels: [] }), off, B)).toBe(true);
    const offT = { ...flt, treatmentTypes: new Set([...flt.treatmentTypes].slice(1)) };
    expect(matches(trial({ treatment_types: [] }), offT, B)).toBe(true);
  });

  it("results posted: off shows all, on keeps only trials with results", () => {
    expect(matches(trial({ has_results: false }), all(), B)).toBe(true);
    expect(matches(trial({ has_results: false }), { ...all(), resultsOnly: true }, B)).toBe(false);
    expect(matches(trial({ has_results: true }), { ...all(), resultsOnly: true }, B)).toBe(true);
    // Combines with the other filters.
    expect(matches(trial({ has_results: true }), { ...all(), resultsOnly: true, phases: new Set(["PHASE3"]) }, B)).toBe(
      false,
    );
    expect(allFilters(file()).resultsOnly).toBe(false);
  });

  it("query matches nct_id, title, drugs, sponsor case-insensitively", () => {
    for (const q of ["nct00000001", "THINGS", "FOOUMAB", "acme"])
      expect(matches(trial(), { ...all(), query: q }, B)).toBe(true);
    expect(matches(trial(), { ...all(), query: "zzz" }, B)).toBe(false);
    expect(matches(trial({ lead_sponsor: null }), { ...all(), query: "acme" }, B)).toBe(false);
  });
});

describe("year range", () => {
  const all = () => allFilters({ ...file(), trials: [trial({ start_year: 2010 }), trial({ start_year: 2026 })] });
  const narrow = (): Filters => ({ ...all(), years: [2020, 2024] });
  it("yearBounds takes min/max non-null start years, [0, 0] when none", () => {
    const ys = [2015, null, 2022].map((start_year) => trial({ start_year }));
    expect(yearBounds(ys)).toEqual([2015, 2022]);
    expect(yearBounds([trial({ start_year: null })])).toEqual([0, 0]);
    expect(yearBounds([])).toEqual([0, 0]);
  });
  it("allFilters sets years to the bounds", () => {
    expect(all().years).toEqual(B);
  });
  it("range includes both boundaries", () => {
    for (const y of [2020, 2022, 2024]) expect(matches(trial({ start_year: y }), narrow(), B)).toBe(true);
    for (const y of [2019, 2025]) expect(matches(trial({ start_year: y }), narrow(), B)).toBe(false);
  });
  it("null start year shows at full range, hidden when narrowed", () => {
    const t = trial({ start_year: null });
    expect(isFullYears(all(), B)).toBe(true);
    expect(matches(t, all(), B)).toBe(true);
    expect(isFullYears(narrow(), B)).toBe(false);
    expect(matches(t, narrow(), B)).toBe(false);
  });
});

describe("setAll / setNone / filterSummary", () => {
  const f = allFilters(file());
  it("setNone empties only that key; setAll restores it", () => {
    const none = setNone(f, "phases");
    expect(none.phases.size).toBe(0);
    expect(none.conditions).toBe(f.conditions);
    expect(none.outcomes).toBe(f.outcomes);
    expect(none.treatmentTypes).toBe(f.treatmentTypes);
    expect(f.phases.size).toBeGreaterThan(0);
    expect(setAll(none, "phases", f.phases).phases).toEqual(f.phases);
  });
  it("filterSummary", () => {
    expect(filterSummary(6, 6)).toBe("all");
    expect(filterSummary(0, 6)).toBe("none");
    expect(filterSummary(2, 6)).toBe("2 of 6");
  });
});

describe("tally / sameFilters", () => {
  it("tally counts every key each trial yields", () => {
    const ts = [trial({ condition_labels: ["A", "B"] }), trial({ condition_labels: ["B"] }), trial({ condition_labels: [] })];
    const m = tally(ts, (t) => t.condition_labels);
    expect([...m.entries()]).toEqual([
      ["A", 1],
      ["B", 2],
    ]);
  });
  it("sameFilters compares sets by content, plus query, results and years", () => {
    const a = allFilters(file());
    const b = allFilters(file());
    expect(sameFilters(a, b)).toBe(true);
    expect(sameFilters(a, setNone(b, "phases"))).toBe(false);
    expect(sameFilters(a, { ...b, query: "x" })).toBe(false);
    expect(sameFilters(a, { ...b, resultsOnly: true })).toBe(false);
    expect(sameFilters(a, { ...b, years: [b.years[0] + 1, b.years[1]] })).toBe(false);
    // Same members, different insertion order: still the same.
    expect(sameFilters(a, { ...b, phases: new Set([...b.phases].reverse()) })).toBe(true);
  });
});

describe("colorFor", () => {
  const order = ["Alpha", "Beta"];
  it("outcome mode", () => {
    expect(colorFor(trial(), "outcome", LIGHT_PALETTE, order)).toBe("#c8102e");
    expect(colorFor(trial(), "outcome", DARK_PALETTE, order)).toBe("#ff8a3d");
  });
  it("outcome mode, light: the editorial-journal values", () => {
    const o = (outcome: ExplorerTrial["outcome"]) => colorFor(trial({ outcome }), "outcome", LIGHT_PALETTE, order);
    expect(o("stopped")).toBe("#222222");
    expect(o("completed_unknown")).toBe("#c9d1d8");
    expect(o("running")).toBe("#3c5488");
    // The unknown-outcome ring stays a mid grey, distinct from the pale completed ground.
    expect(o("unknown")).toBe("#8796a3");
  });
  it("outcome mode, dark: running, completed and stopped are three distinct values", () => {
    const o = (outcome: ExplorerTrial["outcome"]) => colorFor(trial({ outcome }), "outcome", DARK_PALETTE, order);
    const values = new Set(["stopped", "completed_unknown", "running", "unknown", "succeeded"].map((x) => o(x as ExplorerTrial["outcome"])));
    expect(values.size).toBe(5);
  });
  it("phase mode, null phase is unknown", () => {
    expect(colorFor(trial(), "phase", LIGHT_PALETTE, order)).toBe("#8796a3");
    expect(colorFor(trial({ phase: "NA" }), "phase", LIGHT_PALETTE, order)).toBe("#e4e8eb");
    expect(colorFor(trial({ phase: null }), "phase", LIGHT_PALETTE, order)).toBe("#e4e8eb");
    expect(colorFor(trial({ phase: null }), "phase", DARK_PALETTE, order)).toBe("#2b2e33");
  });
  it("disease mode: each condition keeps its own hue, by its place in the area's order", () => {
    const area = ["Multiple sclerosis", "NMOSD", "MOGAD", "Myasthenia gravis", "CIDP", "Autoimmune encephalitis"];
    const light = area.map((c) => colorFor(trial({ condition_labels: [c] }), "disease", LIGHT_PALETTE, area));
    expect(light).toEqual(["#3c5488", "#00a087", "#8e5ea2", "#4dbbd5", "#e0a030", "#7e6148"]);
    const dark = area.map((c) => colorFor(trial({ condition_labels: [c] }), "disease", DARK_PALETTE, area));
    expect(dark).toEqual(DARK_PALETTE.diseases);
    // The largest condition is no longer grey: MS is navy.
    expect(light[0]).not.toBe(LIGHT_PALETTE.completed_unknown);
  });
  it("disease mode: the series cycles past six, and a trial with no condition is unknown", () => {
    const long = Array.from({ length: 8 }, (_, i) => `L${i}`);
    expect(colorFor(trial({ condition_labels: ["L6"] }), "disease", LIGHT_PALETTE, long)).toBe("#3c5488");
    expect(colorFor(trial({ condition_labels: [] }), "disease", LIGHT_PALETTE, order)).toBe("#e4e8eb");
    expect(colorFor(trial({ condition_labels: ["Nope"] }), "disease", LIGHT_PALETTE, order)).toBe("#e4e8eb");
  });
});

describe("diseaseSeries", () => {
  it("is the area's order, then any other first label alphabetically; it ignores share", () => {
    const ts = [
      trial({ condition_labels: ["Beta"] }),
      trial({ condition_labels: ["Beta"] }),
      trial({ condition_labels: ["Zeta", "Alpha"] }),
      trial({ condition_labels: ["Eta"] }),
      trial({ condition_labels: [] }),
    ];
    expect(diseaseSeries(ts, ["Alpha", "Beta"])).toEqual(["Alpha", "Beta", "Eta", "Zeta"]);
  });
});

describe("diseaseRanking", () => {
  it("orders conditions by how many trials list them first, ties in the area's order", () => {
    const ts = [
      trial({ condition_labels: ["Beta"] }),
      trial({ condition_labels: ["Beta", "Alpha"] }),
      trial({ condition_labels: ["Gamma"] }),
      trial({ condition_labels: ["Alpha"] }),
      trial({ condition_labels: [] }),
    ];
    expect(diseaseRanking(ts, ["Alpha", "Beta", "Gamma", "Delta"])).toEqual(["Beta", "Alpha", "Gamma", "Delta"]);
  });
});

describe("emphasisFor", () => {
  it("lifts succeeded trials in outcome mode, minority conditions in disease mode, nothing in phase mode", () => {
    const ranked = ["Beta", "Alpha"];
    const out = emphasisFor("outcome", ranked)!;
    expect(out(trial())).toBe(true);
    expect(out(trial({ outcome: "stopped" }))).toBe(false);
    const dis = emphasisFor("disease", ranked)!;
    expect(dis(trial({ condition_labels: ["Alpha", "Beta"] }))).toBe(true);
    expect(dis(trial({ condition_labels: ["Beta", "Alpha"] }))).toBe(false);
    expect(dis(trial({ condition_labels: [] }))).toBe(false);
    expect(emphasisFor("phase", ranked)).toBeUndefined();
  });
});

describe("disease series", () => {
  it("has six hues, no ink and no grey ground in it", () => {
    for (const p of [LIGHT_PALETTE, DARK_PALETTE]) {
      expect(p.diseases).toHaveLength(6);
      expect(new Set(p.diseases).size).toBe(6);
      expect(p.diseases).not.toContain(p.stopped);
      expect(p.diseases).not.toContain(p.completed_unknown);
    }
    expect("diseaseQuiet" in LIGHT_PALETTE).toBe(false);
  });
});

describe("zoom view", () => {
  const W = 400;
  const H = 300;
  it("starts at 1x with no pan", () => {
    expect(IDENTITY_VIEW).toEqual({ k: 1, x: 0, y: 0 });
  });
  it("zooms about the pointer: the point under it stays put", () => {
    const v = zoomAt(IDENTITY_VIEW, 2, 100, 80, W, H);
    expect(v.k).toBe(2);
    // screen = k * s + (x, y); the content point at (100, 80) is still at (100, 80).
    expect(v.k * 100 + v.x).toBeCloseTo(100);
    expect(v.k * 80 + v.y).toBeCloseTo(80);
  });
  it("clamps to 1x..8x", () => {
    expect(zoomAt(IDENTITY_VIEW, 0.5, 10, 10, W, H)).toEqual(IDENTITY_VIEW);
    expect(zoomAt(IDENTITY_VIEW, 100, 10, 10, W, H).k).toBe(8);
    const v = zoomAt(zoomAt(IDENTITY_VIEW, 6, 200, 150, W, H), 6, 200, 150, W, H);
    expect(v.k).toBe(8);
    // Zooming back out all the way returns exactly to the identity.
    expect(zoomAt(v, 1 / 64, 37, 210, W, H)).toEqual(IDENTITY_VIEW);
  });
  it("clamps the pan so the 1x frame always fills the canvas (the cloud cannot be lost)", () => {
    const v = zoomAt(IDENTITY_VIEW, 2, 200, 150, W, H);
    const far = panBy(v, 10_000, -10_000, W, H);
    expect(far.x).toBe(0);
    expect(far.y).toBe(H - 2 * H);
    expect(panBy(IDENTITY_VIEW, 50, 50, W, H)).toEqual(IDENTITY_VIEW);
    // Zooming at the edge keeps the frame filled too.
    const edge = zoomAt(IDENTITY_VIEW, 3, 0, 0, W, H);
    expect(edge).toEqual({ k: 3, x: 0, y: 0 });
  });
  it("viewPoints scales positions, not the projection's depth or perspective", () => {
    const pts = [{ sx: 100, sy: 80, depth: 0.2, f: 1.1 }];
    expect(viewPoints(pts, { k: 2, x: -100, y: -80 })).toEqual([{ sx: 100, sy: 80, depth: 0.2, f: 1.1 }]);
    expect(viewPoints(pts, IDENTITY_VIEW)).toBe(pts);
  });
  it("hit testing at 2x picks the dot that is drawn under the pointer", () => {
    // Two dots 6px apart at 1x: at 2x they are 12px apart, so a pointer 4px right of the first on
    // screen is nearer the first, though in 1x space it sits closer to the second.
    const base = [
      { sx: 100, sy: 100, depth: 0, f: 1 },
      { sx: 106, sy: 100, depth: 0, f: 1 },
    ];
    const v = zoomAt(IDENTITY_VIEW, 2, 100, 100, W, H);
    const shown = viewPoints(base, v);
    expect(nearestIndex(shown, 104, 100)).toBe(0);
    expect(nearestIndex(shown, 109, 100)).toBe(1);
    expect(nearestIndex(base, 104, 100)).toBe(1);
  });
});

describe("project / nearestIndex", () => {
  it("identity maps origin to centre", () => {
    const [p] = project([{ x: 0, y: 0, z: 0 }], 0, 0, 200, 100, 1);
    expect(p.sx).toBeCloseTo(100);
    expect(p.sy).toBeCloseTo(50);
    expect(p.f).toBeCloseTo(1);
  });
  it("nearer points have larger depth and scale", () => {
    const [a, b] = project([{ x: 0.5, y: 0, z: 0.5 }, { x: 0.5, y: 0, z: -0.5 }], 0, 0, 200, 200, 1);
    expect(a.depth).toBeGreaterThan(b.depth);
    expect(a.f).toBeGreaterThan(b.f);
  });
  it("nearestIndex hits within 12px and misses beyond", () => {
    const pts = project([{ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }], 0, 0, 200, 200, 1);
    expect(nearestIndex(pts, 100, 100)).toBe(0);
    expect(nearestIndex(pts, 100 + 25, 100)).toBe(-1);
    expect(nearestIndex(pts, 100 + 25, 100, 100)).toBeGreaterThanOrEqual(0);
    expect(nearestIndex([], 0, 0)).toBe(-1);
  });
});

describe("liftSentence", () => {
  const s = (o: Partial<ExplorerStats>): ExplorerStats => ({
    baseline_mean: null,
    baseline_range: null,
    by_condition: [],
    lift: null,
    n_averaged: 0,
    n_pool: 0,
    n_short: 0,
    n_succeeded: 0,
    p_value: null,
    success_rate: null,
    verdict: "insufficient",
    ...o,
  });
  it("insufficient", () =>
    expect(liftSentence(s({}))).toBe("Too few successes in this area to measure clustering yet."));
  it("chance names the p-value", () =>
    expect(liftSentence(s({ verdict: "chance", lift: 1.31, baseline_range: [0.64, 1.39], p_value: 0.058394 }))).toBe(
      "Trials that succeeded cluster no more than chance would (p\u00a0=\u00a00.058).",
    ));
  it("clustered names the lift, the shuffled range and the p-value", () =>
    expect(
      liftSentence(s({ verdict: "clustered", lift: 2.345, baseline_range: [0.94, 1.26], p_value: 0.0123 })),
    ).toBe(
      "Trials that succeeded have neighbours that succeed 2.35× as often as the average finished trial (shuffled labels: 0.94–1.26×; p\u00a0=\u00a00.012).",
    ));
  it("clustered with the smallest p reads as a floor", () =>
    expect(
      liftSentence(s({ verdict: "clustered", lift: 2.5, baseline_range: [0.5, 2], p_value: 1 / 10001 })),
    ).toBe(
      "Trials that succeeded have neighbours that succeed 2.50× as often as the average finished trial (shuffled labels: 0.50–2.00×; p\u00a0<\u00a00.001).",
    ));
  it("the p clause never breaks across lines", () => {
    const out = liftSentence(s({ verdict: "chance", p_value: 0.058 }));
    expect(out).toContain("p\u00a0=\u00a00.058");
    expect(liftSentence(s({ verdict: "chance", p_value: 0.0001 }))).toContain("p\u00a0<\u00a00.001");
  });
  it("never says a bare 'successful'", () => {
    for (const v of ["insufficient", "chance", "clustered"] as const)
      expect(liftSentence(s({ verdict: v, lift: 1.5, baseline_range: [0.5, 1.2], p_value: 0.01 }))).not.toMatch(
        /successful/i,
      );
  });
});

describe("formatP", () => {
  it("two significant digits, floored at < 0.001", () => {
    expect(formatP(0.058394)).toBe("0.058");
    expect(formatP(0.5)).toBe("0.5");
    expect(formatP(0.0123)).toBe("0.012");
    expect(formatP(0.001)).toBe("0.001");
    expect(formatP(0.00099)).toBe("< 0.001");
    expect(formatP(1 / 10001)).toBe("< 0.001");
  });
});

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const l = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees and HSL saturation of a #rrggbb colour. */
function hueSat(h: string): [number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d === 0) return [0, 0];
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, sat];
}

describe("light palette legibility", () => {
  it("every outcome fill is at least 3:1 on the white plate", () => {
    for (const o of ["succeeded", "stopped", "running", "unknownRing"] as const)
      expect(contrast(LIGHT_PALETTE[o], "#ffffff")).toBeGreaterThanOrEqual(3);
  });
  it("completed is the pale ground: a lower floor, and still apart from the unknown ring", () => {
    // #c9d1d8 is deliberately quiet (about 1.5:1), but it must not fade into the white plate ...
    expect(contrast(LIGHT_PALETTE.completed_unknown, "#ffffff")).toBeGreaterThanOrEqual(1.4);
    // ... nor into the mid-grey unknown-outcome ring.
    expect(contrast(LIGHT_PALETTE.completed_unknown, LIGHT_PALETTE.unknownRing)).toBeGreaterThanOrEqual(1.5);
  });
  it("no saturated light disease colour sits in the red family (red is for succeeded)", () => {
    for (const c of LIGHT_PALETTE.diseases) {
      const [hue, sat] = hueSat(c);
      // Red proper is about 330..20 degrees; the series' brown (#7e6148, 28 degrees) sits just past it.
      if (sat > 0.2) expect(hue > 20 && hue < 330).toBe(true);
    }
    // The approved editorial series has two light hues (cyan #4dbbd5, ochre #e0a030) near 2.2:1 on white;
    // they are dots with a knockout ring and a named key, never text.
    for (const c of LIGHT_PALETTE.diseases) expect(contrast(c, "#ffffff")).toBeGreaterThanOrEqual(2.2);
  });
});

describe("red is reserved for succeeded", () => {
  it("no disease colour is the succeeded colour", () => {
    expect(LIGHT_PALETTE.diseases).not.toContain(LIGHT_PALETTE.succeeded);
    expect(DARK_PALETTE.diseases).not.toContain(DARK_PALETTE.succeeded);
  });
});

describe("clusterAnchors", () => {
  const at = (label: string | null, x: number, y = 0, z = 0) =>
    trial({ condition_labels: label === null ? [] : [label, "Other"], x, y, z });
  const pts = (ts: ExplorerTrial[]) => ts.map((t) => ({ x: t.x, y: t.y, z: t.z }));

  it("puts the label on the planted cluster, not the centroid", () => {
    const trials = [
      // A: a tight planted cluster at (0.5, 0.5) plus scattered stragglers far away (pulling the centroid off it).
      ...Array.from({ length: 10 }, (_, i) => at("A", 0.5 + (i % 3) * 0.01, 0.5 + (i % 2) * 0.01)),
      ...Array.from({ length: 5 }, (_, i) => at("A", -3 - i, -3)),
      // Background noise from another condition sitting right on A's centroid does not count for A.
      ...Array.from({ length: 20 }, () => at("Z", -1.3, -0.7)),
    ];
    const [got] = clusterAnchors(trials, pts(trials), ["A"]);
    expect(got.label).toBe("A");
    expect(got.x).toBeCloseTo(0.5, 1);
    expect(got.y).toBeCloseTo(0.5, 1);
  });

  it("skips a spread-out condition, a majority condition, a small one, and counts only FIRST labels", () => {
    const trials = [
      ...Array.from({ length: 10 }, (_, i) => at("A", 0, 0.001 * i)), // a real cluster
      ...Array.from({ length: 10 }, (_, i) => at("B", 2 + i, 2 + i)), // spread: each alone within the radius
      ...Array.from({ length: 4 }, () => at("S", 5, 5)), // fewer than 5
      ...Array.from({ length: 3 }, () => trial({ condition_labels: ["Other", "S"], x: 5, y: 5 })), // S only second
      at(null, 9),
    ];
    const got = clusterAnchors(trials, pts(trials), ["A", "B", "S"]);
    expect(got.map((a) => a.label)).toEqual(["A"]);
    // Same map plus a condition holding more than 60% of all trials: it is the background, no label.
    const bg = Array.from({ length: 60 }, () => at("M", 1, 1));
    const all = [...trials, ...bg];
    expect(clusterAnchors(all, pts(all), ["A", "B", "S", "M"]).map((a) => a.label)).toEqual(["A"]);
  });

  it("keeps at most six labels, in config order", () => {
    const labels = Array.from({ length: 8 }, (_, i) => `L${i}`);
    const trials = labels.flatMap((l, i) => Array.from({ length: 5 }, () => at(l, i)));
    expect(clusterAnchors(trials, pts(trials), labels).map((a) => a.label)).toEqual(labels.slice(0, 6));
  });
});

describe("labelPosition", () => {
  it("centres the label on its anchor, inside the canvas", () => {
    expect(labelPosition(100, 80, 40, 400, 300)).toEqual({ x: 100, y: 80 });
  });
  it("clamps a label that would run off an edge", () => {
    expect(labelPosition(5, 80, 40, 400, 300).x).toBe(24); // 20 half-width + 4 margin
    expect(labelPosition(398, 80, 40, 400, 300).x).toBe(376);
    expect(labelPosition(100, -10, 40, 400, 300).y).toBe(10);
    expect(labelPosition(100, 310, 40, 400, 300).y).toBe(290);
  });
});

describe("placeLabels", () => {
  it("leaves labels that do not collide where labelPosition puts them", () => {
    const got = placeLabels([{ sx: 100, sy: 50, width: 40 }, { sx: 300, sy: 50, width: 40 }], 400, 300);
    expect(got).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);
  });
  it("nudges a colliding label down by whole lines", () => {
    const got = placeLabels(
      [
        { sx: 200, sy: 100, width: 80 },
        { sx: 210, sy: 104, width: 120 },
        { sx: 195, sy: 98, width: 60 },
      ],
      400,
      300,
    );
    expect(got[0]).toEqual({ x: 200, y: 100 });
    expect(got[1]).toEqual({ x: 210, y: 118 });
    expect(got[2]).toEqual({ x: 195, y: 140 }); // 112 and 126 touch the first two
    for (let i = 0; i < got.length; i++)
      for (let j = i + 1; j < got.length; j++) expect(Math.abs(got[i]!.y - got[j]!.y)).toBeGreaterThanOrEqual(14);
  });
  it("drops a label with no free slot instead of overlapping another", () => {
    // A 40px-tall canvas has room for about two lines: the rest cannot be placed clear of the others.
    const items = Array.from({ length: 12 }, () => ({ sx: 200, sy: 20, width: 80 }));
    const got = placeLabels(items, 400, 40);
    expect(got[0]).not.toBeNull();
    expect(got.some((g) => g === null)).toBe(true);
    const placed = got.filter((g): g is { x: number; y: number } => g !== null);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(Math.abs(placed[i].x - placed[j].x) >= 86 || Math.abs(placed[i].y - placed[j].y) >= 14).toBe(true);
  });
});

describe("clusterLabels", () => {
  const many: ExplorerCluster[] = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    label: `C${i}`,
    kind: "type",
    n: 2 * i + 1,
    x: i,
    y: 0,
    z: 0,
  }));
  const c = (id: number, label: string, kind: ExplorerCluster["kind"], n: number): ExplorerCluster => ({
    id,
    label,
    kind,
    n,
    x: id,
    y: 0,
    z: 0,
  });
  it("keeps the largest clusters, at most max, and none below 15 trials", () => {
    const desk = clusterLabels(many, 8);
    expect(desk).toHaveLength(8);
    expect(desk.map((a) => a.label)).toEqual(["C29", "C28", "C27", "C26", "C25", "C24", "C23", "C22"]);
    expect(desk[0]).toEqual({ label: "C29", x: 29, y: 0, z: 0 });
    expect(clusterLabels(many, 6)).toHaveLength(6);
    const small = many.slice(0, 10); // n = 1..19: only 15, 17, 19 qualify
    expect(clusterLabels(small, 8).map((a) => a.label)).toEqual(["C9", "C8", "C7"]);
    expect(clusterLabels([], 8)).toEqual([]);
  });
  it("shows a duplicate label once, at its largest instance", () => {
    const dup = [c(0, "A · drugs", "type", 20), c(1, "A · drugs", "type", 90), c(2, "B · devices", "type", 40)];
    expect(clusterLabels(dup, 8)).toEqual([
      { label: "A · drugs", x: 1, y: 0, z: 0 },
      { label: "B · devices", x: 2, y: 0, z: 0 },
    ]);
  });
  it("puts mechanism clusters first, then type, then mixed, each largest first", () => {
    const cs = [
      c(0, "A · mixed", "mixed", 300),
      c(1, "A · drugs", "type", 200),
      c(2, "A · class X (x)", "mechanism", 16),
      c(3, "A · behavioural", "type", 50),
      c(4, "A · class Y", "mechanism", 40),
      c(5, "A · class Z", "mechanism", 10), // below 15: never shown
    ];
    expect(clusterLabels(cs, 8).map((a) => a.label)).toEqual([
      "A · class Y",
      "A · class X (x)",
      "A · drugs",
      "A · behavioural",
      "A · mixed",
    ]);
  });
  it("still caps after ordering and de-duplicating", () => {
    const cs = [
      ...Array.from({ length: 5 }, (_, i) => c(i, `M${i}`, "mechanism", 20 + i)),
      ...Array.from({ length: 5 }, (_, i) => c(10 + i, "T", "type", 100 + i)),
      ...Array.from({ length: 5 }, (_, i) => c(20 + i, `T${i}`, "type", 50 + i)),
    ];
    expect(clusterLabels(cs, 8).map((a) => a.label)).toEqual(["M4", "M3", "M2", "M1", "M0", "T", "T4", "T3"]);
    expect(clusterLabels(cs, 6).map((a) => a.label)).toEqual(["M4", "M3", "M2", "M1", "M0", "T"]);
  });
});

describe("paintedClasses", () => {
  it("is the classes some trial has as its only class, plus NONE when a trial has none", () => {
    const ts = [
      trial({ mechanisms: ["a"], modalities: ["antibody", "protein"] }),
      trial({ mechanisms: ["a", "b"], modalities: ["protein"] }),
      trial({ mechanisms: [], modalities: [] }),
    ];
    expect([...paintedClasses(ts, "mechanism")].sort()).toEqual([NONE, "a"].sort());
    expect([...paintedClasses(ts, "modality")].sort()).toEqual([NONE, "protein"].sort());
    expect([...paintedClasses([trial({ mechanisms: ["a"] })], "mechanism")]).toEqual(["a"]);
  });
  it("panel d texts use the shown casing for modality", () => {
    const t = trial({ mechanisms: ["anti-CD20", "x"], modalities: ["small molecule"] });
    expect(mechanismText(t)).toBe("anti-CD20 +1");
    expect(modalityText(t)).toBe("Small molecule");
  });
});


describe("yearSpan", () => {
  it("joins start and end with an en dash, marking estimated ends", () => {
    expect(yearSpan(trial({ start_year: 2014, end_year: 2019, end_estimated: false }))).toBe("2014–2019");
    expect(yearSpan(trial({ start_year: 2021, end_year: null, end_estimated: false }))).toBe("2021–");
    expect(yearSpan(trial({ start_year: 2021, end_year: 2025, end_estimated: true }))).toBe("2021–2025 (est.)");
    expect(yearSpan(trial({ start_year: null, end_year: null }))).toBe("");
    expect(yearSpan(trial({ start_year: null, end_year: 2019, end_estimated: false }))).toBe("–2019");
  });
});

describe("popupLines", () => {
  it("names the trial, then drugs, treatment types, phase and years", () => {
    const t = trial({
      nct_id: "NCT01234567",
      title: "A Study of Things",
      drugs: ["a", "b", "c"],
      treatment_types: ["DRUG"],
      phase: "PHASE3",
      start_year: 2014,
      end_year: 2019,
      end_estimated: false,
    });
    expect(popupLines(t)).toEqual(["NCT01234567 · A Study of Things", "a, b +1 · Drug · Phase 3 · 2014–2019"]);
  });

  it("skips empty parts and keeps the first two treatment types", () => {
    const t = trial({
      drugs: [],
      treatment_types: ["BEHAVIORAL", "DEVICE", "DRUG"],
      phase: null,
      start_year: null,
      end_year: null,
    });
    expect(popupLines(t)[1]).toBe("Behavioral, Device · Not applicable");
  });
});

describe("popupPosition", () => {
  it("sits centred above the dot, its bottom edge 10px above it", () => {
    expect(popupPosition(500, 300, 200, 60, 1000, 600)).toEqual({ left: 400, top: 230, below: false });
  });

  it("takes a larger gap, so the card can clear the dot's ring", () => {
    expect(popupPosition(500, 300, 200, 60, 1000, 600, 18)).toEqual({ left: 400, top: 222, below: false });
  });

  it("flips below the dot only at the top edge", () => {
    expect(popupPosition(500, 40, 200, 60, 1000, 600)).toEqual({ left: 400, top: 50, below: true });
    // Near the bottom it still sits above.
    expect(popupPosition(500, 590, 200, 60, 1000, 600)).toEqual({ left: 400, top: 520, below: false });
  });

  it("is clamped horizontally to a 4px margin inside the panel", () => {
    expect(popupPosition(20, 300, 200, 60, 1000, 600).left).toBe(4);
    expect(popupPosition(990, 300, 200, 60, 1000, 600).left).toBe(1000 - 200 - 4);
    // Wider than the panel: pinned to the left margin.
    expect(popupPosition(100, 300, 400, 60, 320, 600).left).toBe(4);
  });
});

describe("columnLabels", () => {
  const items = [
    { sx: 120, sy: 200, width: 40 },
    { sx: 150, sy: 202, width: 60 },
    { sx: 105, sy: 50, width: 30 },
  ];
  it("stacks labels down from the top, in the order of their dots' height", () => {
    expect(columnLabels(items, 375, 40, "right").map((p) => p.y)).toEqual([40 + 14, 40 + 28, 40]);
  });
  it("sets the column on the side given, its inner edge flush, leaders ending on one line", () => {
    const at = columnLabels(items, 375, 40, "right");
    at.forEach((p, i) => expect(p.x - items[i].width / 2).toBe(311));
    expect(new Set(at.map((p) => p.lx))).toEqual(new Set([308]));
    const left = columnLabels(items, 375, 40, "left");
    left.forEach((p, i) => expect(p.x + items[i].width / 2).toBe(64));
    expect(new Set(left.map((p) => p.lx))).toEqual(new Set([67]));
  });
});

describe("columnSide", () => {
  it("puts the column away from the clusters, judged once from their unrotated positions", () => {
    expect(columnSide([{ x: -0.4 }, { x: 0.1 }])).toBe("right");
    expect(columnSide([{ x: 0.4 }, { x: 0.1 }])).toBe("left");
    expect(columnSide([])).toBe("right");
  });
});

describe("successGroups", () => {
  const many = (n: number, o: Partial<ExplorerTrial>, ok = 0): ExplorerTrial[] =>
    Array.from({ length: n }, (_, i) =>
      trial({ in_pool: true, outcome: i < ok ? "succeeded" : "unknown", ...o }),
    );

  it("counts a multi-mechanism trial in each group and ignores trials outside the pool", () => {
    const ts = [
      trial({ mechanisms: ["PD-1", "CTLA-4"], outcome: "succeeded" }),
      trial({ mechanisms: ["PD-1"], outcome: "unknown" }),
      trial({ mechanisms: ["PD-1"], in_pool: false, outcome: "succeeded" }),
    ];
    expect(successGroups(ts, "mechanism", 1)).toEqual([
      { group: "PD-1", finished: 2, succeeded: 1, rate: 0.5 },
      { group: "CTLA-4", finished: 1, succeeded: 1, rate: 1 },
    ]);
  });

  it("nulls the rate below min_group: 9 finished is too few, 10 is not", () => {
    const nine = successGroups(many(9, { modalities: ["antibody"] }, 3), "modality", 10);
    expect(nine).toEqual([{ group: "antibody", finished: 9, succeeded: 3, rate: null }]);
    const ten = successGroups(many(10, { modalities: ["antibody"] }, 3), "modality", 10);
    expect(ten[0].rate).toBeCloseTo(0.3);
  });

  it("sorts by finished desc, then name, and keeps the top N", () => {
    const ts = [
      ...many(3, { modalities: ["b"] }),
      ...many(5, { modalities: ["a"] }),
      ...many(3, { modalities: ["c"] }),
    ];
    expect(successGroups(ts, "modality", 1, 2).map((g) => g.group)).toEqual(["a", "b"]);
  });

  it("disease view counts success per condition (succeeded_in), not the trial outcome", () => {
    const ts = [
      trial({ condition_labels: ["A", "B"], succeeded_in: ["A"], outcome: "succeeded", in_pool: true }),
    ];
    expect(successGroups(ts, "disease", 1, 8, ["A", "B"])).toEqual([
      { group: "A", finished: 1, succeeded: 1, rate: 1 },
      { group: "B", finished: 1, succeeded: 0, rate: 0 },
    ]);
  });

  it("disease view matches stats.by_condition on the fixture, in area order", () => {
    const f = readFixture<ExplorerFile>("explorer.json");
    const order = f.stats.by_condition.map((c) => c.label);
    const got = successGroups(f.trials, "disease", f.method.min_group, 8, order);
    expect(got.map(({ group, finished, succeeded }) => ({ label: group, finished, succeeded }))).toEqual(
      f.stats.by_condition,
    );
  });
});

describe("mechanism and modality: colour", () => {
  const L = LIGHT_PALETTE;
  const D = DARK_PALETTE;
  const mech = (mechanisms: string[], top: string[], p = L) =>
    colorFor(trial({ mechanisms }), "mechanism", p, [], top);
  const top = ["anti-CD20", "S1P modulator", "NRF2 activator", "FcRn blocker", "C5 inhibitor", "anti-CD19"];

  it("has five colour modes: Outcome, Phase, Disease, Mechanism, Modality", () => {
    expect(MODES.map(([, l]) => l)).toEqual(["Outcome", "Phase", "Disease", "Mechanism", "Modality"]);
  });
  it("palettes carry a neutral other-category and multiple colour", () => {
    expect(L.otherCategory).toBe("#9aa5b1");
    expect(D.otherCategory).toBe("#6c7680");
    expect(L.multiple).toBe("#5b6268");
    expect(D.multiple).toBe("#b9bdc2");
  });
  it("the six commonest classes take the editorial series in order; others the other-category grey", () => {
    expect(top.map((m) => mech([m], top))).toEqual(L.diseases);
    expect(top.map((m) => mech([m], top, D))).toEqual(D.diseases);
    expect(mech(["anti-IL6R"], top)).toBe(L.otherCategory);
  });
  it("a trial with several classes is 'multiple'; one with none is unknown", () => {
    expect(mech(["anti-CD20", "NRF2 activator"], top)).toBe(L.multiple);
    expect(mech(["anti-CD20", "NRF2 activator"], top, D)).toBe(D.multiple);
    expect(mech([], top)).toBe(L.unknown);
  });
  it("mechanismSeries ranks classes by trial count over the whole file, ties alphabetically, at most six", () => {
    const ts = [
      ...Array.from({ length: 3 }, () => trial({ mechanisms: ["b"] })),
      ...Array.from({ length: 3 }, () => trial({ mechanisms: ["a"] })),
      trial({ mechanisms: ["c", "b"] }),
      ...["d", "e", "f", "g", "h"].map((m) => trial({ mechanisms: [m] })),
      trial({ mechanisms: [] }),
    ];
    expect(mechanismSeries(ts)).toEqual(["b", "a", "c", "d", "e", "f"]);
  });
  it("modality: the fixed order takes the series, 'other' and unknown modalities the other-category grey", () => {
    expect(MODALITIES).toEqual([
      "small molecule",
      "antibody",
      "protein",
      "oligonucleotide",
      "cell therapy",
      "gene therapy",
      "other",
    ]);
    const mod = (modalities: string[], p = L) => colorFor(trial({ modalities }), "modality", p, []);
    expect(MODALITIES.slice(0, 6).map((m) => mod([m]))).toEqual(L.diseases);
    expect(MODALITIES.slice(0, 6).map((m) => mod([m], D))).toEqual(D.diseases);
    expect(mod(["other"])).toBe(L.otherCategory);
    expect(mod(["antibody", "small molecule"])).toBe(L.multiple);
    expect(mod([])).toBe(L.unknown);
  });
  it("no mechanism or modality colour is the succeeded colour", () => {
    for (const p of [L, D]) for (const c of [p.otherCategory, p.multiple]) expect(c).not.toBe(p.succeeded);
  });
  it("emphasis lifts only series-coloured dots: not other, multiple or none", () => {
    const m = emphasisFor("mechanism", [], ["x", "y"])!;
    expect(m(trial({ mechanisms: ["x"] }))).toBe(true);
    expect(m(trial({ mechanisms: ["z"] }))).toBe(false);
    expect(m(trial({ mechanisms: ["x", "y"] }))).toBe(false);
    expect(m(trial({ mechanisms: [] }))).toBe(false);
    const d = emphasisFor("modality", [])!;
    expect(d(trial({ modalities: ["antibody"] }))).toBe(true);
    expect(d(trial({ modalities: ["other"] }))).toBe(false);
    expect(d(trial({ modalities: ["antibody", "protein"] }))).toBe(false);
    expect(d(trial({ modalities: [] }))).toBe(false);
  });
});

describe("mechanism and modality: filters", () => {
  const base = (): Filters => allFilters({ ...file(), trials: [trial({ mechanisms: ["a"], modalities: ["antibody"] })] });

  it("allFilters switches on every class and modality in the file, plus 'none'", () => {
    const f = allFilters(file());
    expect([...f.mechanisms].sort()).toEqual([NONE, "NRF2 activator", "anti-CD20"].sort());
    expect([...f.modalities].sort()).toEqual([NONE, "antibody", "small molecule"].sort());
  });
  it("a trial with no class passes iff 'none' is on; otherwise iff any of its classes is on", () => {
    const f = base();
    const none = trial({ mechanisms: [] });
    expect(matches(none, f, B)).toBe(true);
    expect(matches(none, { ...f, mechanisms: new Set(["a"]) }, B)).toBe(false);
    expect(matches(none, { ...f, mechanisms: new Set([NONE]) }, B)).toBe(true);
    const two = trial({ mechanisms: ["a", "b"], modalities: ["antibody"] });
    expect(matches(two, { ...f, mechanisms: new Set(["b"]) }, B)).toBe(true);
    expect(matches(two, { ...f, mechanisms: new Set([NONE]) }, B)).toBe(false);
    expect(matches(two, { ...f, mechanisms: new Set() }, B)).toBe(false);
  });
  it("the same rule for modalities", () => {
    const f = base();
    expect(matches(trial({ modalities: [] }), { ...f, modalities: new Set(["antibody"]) }, B)).toBe(false);
    expect(matches(trial({ modalities: [] }), { ...f, modalities: new Set([NONE]) }, B)).toBe(true);
    expect(matches(trial({ modalities: ["antibody"] }), { ...f, modalities: new Set([NONE]) }, B)).toBe(false);
    expect(matches(trial({ modalities: ["antibody", "protein"] }), { ...f, modalities: new Set(["protein"]) }, B)).toBe(true);
  });
  it("filterCounts counts every class a trial touches, and trials with none under 'none'", () => {
    const c = filterCounts([
      trial({ mechanisms: ["a", "b"], modalities: ["antibody"] }),
      trial({ mechanisms: ["a"], modalities: ["antibody", "protein"] }),
      trial({ mechanisms: [], modalities: [] }),
    ]);
    expect(Object.fromEntries(c.mechanisms)).toEqual({ a: 2, b: 1, [NONE]: 1 });
    expect(Object.fromEntries(c.modalities)).toEqual({ antibody: 2, protein: 1, [NONE]: 1 });
  });
  it("sameFilters compares the mechanism and modality sets", () => {
    const a = allFilters(file());
    expect(sameFilters(a, { ...a, mechanisms: new Set([NONE]) })).toBe(false);
    expect(sameFilters(a, { ...a, modalities: new Set([NONE]) })).toBe(false);
    expect(sameFilters(a, setNone(a, "mechanisms"))).toBe(false);
  });
});

describe("mechanism and modality: hover card", () => {
  it("line 2 names the first class (+n) and the modality after the drugs", () => {
    const t = trial({
      drugs: ["a"],
      mechanisms: ["anti-CD20", "BTK inhibitor"],
      modalities: ["antibody"],
      treatment_types: ["DRUG"],
      phase: "PHASE3",
      start_year: 2014,
      end_year: 2019,
    });
    expect(popupLines(t)[1]).toBe("a · anti-CD20 +1 · Antibody · Drug · Phase 3 · 2014–2019");
    const two = trial({ drugs: [], mechanisms: [], modalities: ["antibody", "small molecule"], phase: null, start_year: null, end_year: null });
    expect(popupLines(two)[1]).toBe("Antibody +1 · Drug · Not applicable");
  });
});
