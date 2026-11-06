import { describe, expect, it } from "vitest";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  allFilters,
  colorFor,
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
  it("phase mode, null phase is unknown", () => {
    expect(colorFor(trial(), "phase", LIGHT_PALETTE, order)).toBe("#8796a3");
    expect(colorFor(trial({ phase: "NA" }), "phase", LIGHT_PALETTE, order)).toBe("#e4e8eb");
    expect(colorFor(trial({ phase: null }), "phase", LIGHT_PALETTE, order)).toBe("#e4e8eb");
    expect(colorFor(trial({ phase: null }), "phase", DARK_PALETTE, order)).toBe("#2b2e33");
  });
  it("disease mode uses first label index, mod length", () => {
    expect(colorFor(trial(), "disease", LIGHT_PALETTE, order)).toBe("#111111");
    expect(colorFor(trial({ condition_labels: ["Beta"] }), "disease", LIGHT_PALETTE, order)).toBe("#c8102e");
    const long = Array.from({ length: 8 }, (_, i) => `L${i}`);
    expect(colorFor(trial({ condition_labels: ["L7"] }), "disease", LIGHT_PALETTE, long)).toBe("#c8102e");
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
      "Successful trials' neighbours succeed 2.3× more often than chance (shuffled: 0.9–1.3×).",
    ));
});
