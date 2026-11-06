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
  matches,
  nearestIndex,
  project,
} from "../src/lib/explorer";
import type { ExplorerFile, ExplorerStats, ExplorerTrial } from "../src/types";
import { readFixture } from "./helpers";

const trial = (o: Partial<ExplorerTrial> = {}): ExplorerTrial => ({
  condition_labels: ["Alpha", "Beta"],
  drugs: ["fooumab"],
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

const file = (): ExplorerFile => readFixture<ExplorerFile>("explorer.json");

describe("allFilters / matches", () => {
  it("allFilters includes every trial in the fixture", () => {
    const f = file();
    const flt = allFilters(f);
    expect(f.trials.length).toBeGreaterThan(0);
    for (const t of f.trials) expect(matches(t, flt)).toBe(true);
  });

  const all = () => ({
    conditions: new Set(["Alpha", "Beta"]),
    phases: new Set(["PHASE2"]),
    outcomes: new Set(["succeeded" as const]),
    treatmentTypes: new Set(["DRUG"]),
    query: "",
  });

  it("matches with all filters on", () => expect(matches(trial(), all())).toBe(true));

  it("any label on is enough; none on excludes", () => {
    expect(matches(trial(), { ...all(), conditions: new Set(["Beta"]) })).toBe(true);
    expect(matches(trial(), { ...all(), conditions: new Set(["Gamma"]) })).toBe(false);
  });

  it("filters phase, outcome and treatment type", () => {
    expect(matches(trial(), { ...all(), phases: new Set(["PHASE3"]) })).toBe(false);
    expect(matches(trial(), { ...all(), outcomes: new Set(["stopped" as const]) })).toBe(false);
    expect(matches(trial(), { ...all(), treatmentTypes: new Set(["DEVICE"]) })).toBe(false);
  });

  it("null phase falls in the NA bucket", () => {
    expect(matches(trial({ phase: null }), { ...all(), phases: new Set(["NA"]) })).toBe(true);
    expect(matches(trial({ phase: null }), { ...all(), phases: new Set() })).toBe(false);
  });

  it("empty condition_labels or treatment_types always pass that filter", () => {
    const flt = all();
    for (const t of [trial({ condition_labels: [] }), trial({ treatment_types: [] })]) {
      expect(matches(t, flt)).toBe(true);
      expect(matches(t, { ...all(), conditions: new Set(["Gamma"]) })).toBe(t.condition_labels.length === 0);
      expect(matches(t, { ...all(), treatmentTypes: new Set(["DEVICE"]) })).toBe(t.treatment_types.length === 0);
    }
    const off = { ...flt, conditions: new Set([...flt.conditions].slice(1)) };
    expect(matches(trial({ condition_labels: [] }), off)).toBe(true);
    const offT = { ...flt, treatmentTypes: new Set([...flt.treatmentTypes].slice(1)) };
    expect(matches(trial({ treatment_types: [] }), offT)).toBe(true);
  });

  it("query matches nct_id, title, drugs, sponsor case-insensitively", () => {
    for (const q of ["nct00000001", "THINGS", "FOOUMAB", "acme"])
      expect(matches(trial(), { ...all(), query: q })).toBe(true);
    expect(matches(trial(), { ...all(), query: "zzz" })).toBe(false);
    expect(matches(trial({ lead_sponsor: null }), { ...all(), query: "acme" })).toBe(false);
  });
});

describe("colorFor", () => {
  const order = ["Alpha", "Beta"];
  it("outcome mode", () => {
    expect(colorFor(trial(), "outcome", LIGHT_PALETTE, order)).toBe("#c8102e");
    expect(colorFor(trial({ outcome: "stopped" }), "outcome", DARK_PALETTE, order)).toBe("#eceae4");
  });
  it("outcome mode: running is a visible grey; unknown is a mid-grey ring colour", () => {
    expect(colorFor(trial({ outcome: "running" }), "outcome", LIGHT_PALETTE, order)).toBe("#9aa6b0");
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
    success_rate: null,
    verdict: "insufficient",
    ...o,
  });
  it("insufficient", () =>
    expect(liftSentence(s({}))).toBe("Too few successes in this area to measure clustering yet."));
  it("chance", () =>
    expect(liftSentence(s({ verdict: "chance" }))).toBe(
      "Successful trials cluster no more than chance would.",
    ));
  it("clustered", () =>
    expect(liftSentence(s({ verdict: "clustered", lift: 2.345, baseline_range: [0.94, 1.26] }))).toBe(
      "Successful trials' neighbours succeed 2.35× more often than chance (shuffled: 0.94–1.26×).",
    ));
  it("clustered, but within 10% of the shuffled maximum", () =>
    expect(liftSentence(s({ verdict: "clustered", lift: 1.44, baseline_range: [0.59, 1.41] }))).toBe(
      "Successful trials' neighbours succeed 1.44× more often than chance (shuffled: 0.59–1.41×) — just above the shuffled range.",
    ));
  it("clustered well above 1.1 × the shuffled maximum is not hedged", () =>
    expect(liftSentence(s({ verdict: "clustered", lift: 2.5, baseline_range: [0.5, 2] }))).toBe(
      "Successful trials' neighbours succeed 2.50× more often than chance (shuffled: 0.50–2.00×).",
    ));
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
