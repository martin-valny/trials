import { describe, expect, it } from "vitest";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  allFilters,
  clusterAnchors,
  colorFor,
  labelPosition,
  placeLabels,
  liftSentence,
  formatP,
  filterSummary,
  isFullYears,
  matches,
  setAll,
  setNone,
  yearBounds,
  nearestIndex,
  project,
  popupLines,
  popupPosition,
  yearSpan,
} from "../src/lib/explorer";
import type { Filters } from "../src/lib/explorer";
import type { ExplorerFile, ExplorerStats, ExplorerTrial } from "../src/types";
import { readFixture } from "./helpers";

const trial = (o: Partial<ExplorerTrial> = {}): ExplorerTrial => ({
  condition_labels: ["Alpha", "Beta"],
  drugs: ["fooumab"],
  end_estimated: false,
  end_year: 2022,
  enrollment: 10,
  has_results: false,
  lead_sponsor: "Acme Pharma",
  nct_id: "NCT00000001",
  outcome: "succeeded",
  phase: "PHASE2",
  start_year: 2020,
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

describe("colorFor", () => {
  const order = ["Alpha", "Beta"];
  it("outcome mode", () => {
    expect(colorFor(trial(), "outcome", LIGHT_PALETTE, order)).toBe("#c8102e");
    expect(colorFor(trial({ outcome: "stopped" }), "outcome", DARK_PALETTE, order)).toBe("#eceae4");
  });
  it("outcome mode: running is a visible grey; unknown is a mid-grey ring colour", () => {
    expect(colorFor(trial({ outcome: "running" }), "outcome", LIGHT_PALETTE, order)).toBe("#8592a0");
    expect(colorFor(trial({ outcome: "running" }), "outcome", DARK_PALETTE, order)).toBe("#5f666e");
    expect(colorFor(trial({ outcome: "unknown" }), "outcome", LIGHT_PALETTE, order)).toBe("#8796a3");
    expect(colorFor(trial({ outcome: "unknown" }), "outcome", DARK_PALETTE, order)).toBe("#6c7f93");
  });
  it("phase mode, null phase is unknown", () => {
    expect(colorFor(trial(), "phase", LIGHT_PALETTE, order)).toBe("#8796a3");
    expect(colorFor(trial({ phase: "NA" }), "phase", LIGHT_PALETTE, order)).toBe("#e4e8eb");
    expect(colorFor(trial({ phase: null }), "phase", LIGHT_PALETTE, order)).toBe("#e4e8eb");
    expect(colorFor(trial({ phase: null }), "phase", DARK_PALETTE, order)).toBe("#2b2e33");
  });
  it("disease mode uses first label index, mod length", () => {
    expect(colorFor(trial(), "disease", LIGHT_PALETTE, order)).toBe("#111111");
    expect(colorFor(trial({ condition_labels: ["Beta"] }), "disease", LIGHT_PALETTE, order)).toBe("#7a5c2e");
    expect(colorFor(trial({ condition_labels: ["Beta"] }), "disease", DARK_PALETTE, order)).toBe("#c8a96a");
    expect(colorFor(trial({ condition_labels: ["Gamma"] }), "disease", LIGHT_PALETTE, ["Alpha", "Beta", "Gamma"])).toBe(
      "#5f8a7a",
    );
    const long = Array.from({ length: 8 }, (_, i) => `L${i}`);
    expect(colorFor(trial({ condition_labels: ["L7"] }), "disease", LIGHT_PALETTE, long)).toBe("#7a5c2e");
    expect(colorFor(trial({ condition_labels: [] }), "disease", LIGHT_PALETTE, order)).toBe("#e4e8eb");
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
    for (const o of ["succeeded", "stopped", "completed_unknown", "running", "unknownRing"] as const)
      expect(contrast(LIGHT_PALETTE[o], "#ffffff")).toBeGreaterThanOrEqual(3);
  });
  it("no saturated light disease colour sits in the red family (red is for succeeded)", () => {
    for (const c of LIGHT_PALETTE.diseases) {
      const [hue, sat] = hueSat(c);
      if (sat > 0.2) expect(hue > 30 && hue < 330).toBe(true);
    }
    expect(contrast(LIGHT_PALETTE.diseases[2], "#ffffff")).toBeGreaterThanOrEqual(3);
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
      for (let j = i + 1; j < got.length; j++) expect(Math.abs(got[i].y - got[j].y)).toBeGreaterThanOrEqual(14);
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
  it("sits 12px right of and below the pointer", () => {
    expect(popupPosition(10, 10, 200, 60, 1000, 600)).toEqual({ left: 22, top: 22 });
  });

  it("flips left and up near the far edges and stays inside the panel", () => {
    const p = popupPosition(990, 590, 200, 60, 1000, 600);
    expect(p.left).toBeLessThanOrEqual(1000 - 200 - 4);
    expect(p.top).toBeLessThanOrEqual(600 - 60 - 4);
    expect(p).toEqual({ left: 990 - 12 - 200, top: 590 - 12 - 60 });
  });

  it("clamps to a 4px margin when the card cannot fit either side", () => {
    expect(popupPosition(100, 30, 300, 80, 320, 100)).toEqual({ left: 4, top: 4 });
  });
});
