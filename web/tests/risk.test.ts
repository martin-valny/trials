import { describe, expect, it } from "vitest";
import { aboveLine, countAbove, formatPct, formatRange, rankTrials, scaleMax, scalePos, targetSummary, vsTypical } from "../src/lib/risk";
import type { PipelineFile, RiskFile, TrialsIndex } from "../src/types";
import { readFixture } from "./helpers";

const risk = readFixture<RiskFile>("risk.json");
const pipeline = readFixture<PipelineFile>("pipeline.json");
const index = readFixture<TrialsIndex>("trials.json");

describe("formatting", () => {
  it("formats a percentage", () => {
    expect(formatPct(0.183)).toBe("18%");
    expect(formatPct(0.001)).toBe("<1%");
    expect(formatPct(0.005)).toBe("1%");
  });
  it("formats a range with an en dash", () => {
    expect(formatRange(0.1, 0.29)).toBe("10–29");
  });
  it("never shows a near-zero range as certainty", () => {
    // a model estimate of exactly 0 is still an estimate: it reads "<1", never "0"
    expect(formatRange(0, 0.004)).toBe("<1–<1");
    expect(formatRange(0, 0.024)).toBe("<1–2");
    expect(formatRange(0.002, 0.004)).toBe("<1–<1");
    expect(formatRange(0, 0)).toBe("<1–<1");
    expect(formatRange(0.028, 0.25)).toBe("3–25");
  });
  it("compares with the typical rate", () => {
    expect(vsTypical(0.25, 0.19)).toBe("above");
    expect(vsTypical(0.2, 0.19)).toBe("near");
    expect(vsTypical(0.1, 0.19)).toBe("below");
  });
  it("is near typical whenever the range contains the typical rate", () => {
    expect(vsTypical(0.25, 0.2, 0.028, 0.25)).toBe("near");
    expect(vsTypical(0.1, 0.19, 0.05, 0.19)).toBe("near");
    expect(vsTypical(0.34, 0.2, 0.21, 0.46)).toBe("above");
    expect(vsTypical(0.05, 0.2, 0.01, 0.12)).toBe("below");
  });
  it("positions on the scale and clamps", () => {
    expect(scaleMax).toBe(0.6);
    expect(scalePos(0.3)).toBeCloseTo(0.5);
    expect(scalePos(0.9)).toBe(1);
    expect(scalePos(-0.1)).toBe(0);
  });
});

describe("rankTrials", () => {
  const ids = Object.keys(risk.trials ?? {});

  it("has a spread of estimates in the fixture", () => {
    expect(new Set(ids.map((i) => risk.trials?.[i]?.p)).size).toBeGreaterThan(2);
  });

  it("sorts by estimate, highest first", () => {
    const rows = rankTrials(risk, {}, "estimate", pipeline, index);
    expect(rows.map((r) => r.nct).sort()).toEqual([...ids].sort());
    const ps = rows.map((r) => r.p);
    expect(ps).toEqual([...ps].sort((a, b) => b - a));
  });

  it("sorts by difference from the typical rate", () => {
    const rows = rankTrials(risk, {}, "difference", pipeline, index);
    const d = rows.map((r) => r.p - r.typical);
    expect(d).toEqual([...d].sort((a, b) => b - a));
  });

  it("joins title, phase, target, diseases and company", () => {
    const row = rankTrials(risk, {}, "estimate", pipeline, index)[0]!;
    const summary = index.trials.find((t) => t.nct_id === row.nct)!;
    expect(row.title).toBe(summary.title);
    expect(row.phase).toMatch(/^Phase \d(\/\d)?$/);
    expect(row.target).toBe("cd20");
    expect(row.diseases).toEqual(["MS"]);
    expect(row.company).toBeTruthy();
  });

  it("filters by disease, company and target", () => {
    expect(rankTrials(risk, { disease: ["MS"] }, "estimate", pipeline, index)).toHaveLength(ids.length);
    expect(rankTrials(risk, { disease: ["XX"] }, "estimate", pipeline, index)).toHaveLength(0);
    expect(rankTrials(risk, { target: ["cd20"] }, "estimate", pipeline, index)).toHaveLength(ids.length);
    expect(rankTrials(risk, { target: ["cd19"] }, "estimate", pipeline, index)).toHaveLength(0);
    const company = rankTrials(risk, {}, "estimate", pipeline, index)[0]!.company!;
    const some = rankTrials(risk, { company: [company] }, "estimate", pipeline, index);
    expect(some.length).toBeGreaterThan(0);
    expect(some.every((r) => r.company === company)).toBe(true);
  });

  it("gives a trial outside any row no target and the raw sponsor; 'none' filters to those", () => {
    const gone = ids[0]!;
    const p2: PipelineFile = {
      ...pipeline,
      rows: pipeline.rows.map((r) => ({ ...r, marks: r.marks.filter((m) => m.n !== gone) })),
    };
    const rows = rankTrials(risk, {}, "estimate", p2, index);
    const row = rows.find((r) => r.nct === gone)!;
    expect(row.target).toBeNull();
    expect(row.diseases).toEqual([]);
    expect(row.company).toBe(index.trials.find((t) => t.nct_id === gone)!.lead_sponsor);
    expect(rankTrials(risk, { target: ["none"] }, "estimate", p2, index).map((r) => r.nct)).toEqual([gone]);
  });

  it("finds a trial in two rows by either row and either disease", () => {
    const nct = ids[0]!;
    const base = pipeline.rows[0]!.marks.find((m) => m.n === nct)!;
    const clean = pipeline.rows.map((r) => ({ ...r, marks: r.marks.filter((m) => m.n !== nct) }));
    const p2: PipelineFile = {
      ...pipeline,
      rows: clean.map((r, i) =>
        i === 0
          ? { ...r, marks: [...r.marks, { ...base, dz: ["MS"] }] }
          : i === 1
            ? { ...r, marks: [...r.marks, { ...base, dz: ["RA"] }] }
            : r,
      ),
    };
    const [r0, r1] = [p2.rows[0]!.id, p2.rows[1]!.id];
    const find = (f: Parameters<typeof rankTrials>[1]) =>
      rankTrials(risk, f, "estimate", p2, index).some((r) => r.nct === nct);
    expect(find({ target: [r0] })).toBe(true);
    expect(find({ target: [r1] })).toBe(true);
    expect(find({ target: ["none"] })).toBe(false);
    expect(find({ disease: ["MS"] })).toBe(true);
    expect(find({ disease: ["RA"] })).toBe(true);
    const row = rankTrials(risk, {}, "estimate", p2, index).find((r) => r.nct === nct)!;
    expect(row.target).toBe(r0);
    expect(row.targets).toEqual([r0, r1]);
  });

  it("works without the pipeline or the index", () => {
    const rows = rankTrials(risk, {}, "estimate", null, null);
    expect(rows).toHaveLength(ids.length);
    expect(rows[0]!.target).toBeNull();
    expect(rows[0]!.title).toBe("");
  });

  it("returns [] when trials are absent", () => {
    expect(rankTrials({ ...risk, trials: undefined }, {}, "estimate", pipeline, index)).toEqual([]);
  });
});

describe("targetSummary", () => {
  it("reads overall and by disease", () => {
    expect(targetSummary(risk, "cd20")).toEqual(risk.targets?.cd20?.all);
    expect(targetSummary(risk, "cd20", "MS")).toEqual(risk.targets?.cd20?.by_disease.MS);
    expect(targetSummary(risk, "cd20", "XX")).toBeNull();
    expect(targetSummary(risk, "nope")).toBeNull();
    expect(targetSummary({ ...risk, targets: undefined }, "cd20")).toBeNull();
  });
});

test("an estimate of exactly 0 or under 0.5% never reads as 0%", () => {
  expect(formatPct(0)).toBe("<1%");
  expect(formatPct(0.0049)).toBe("<1%");
});

describe("countAbove", () => {
  it("counts rows above their typical rate, a range containing typical counting as near", () => {
    const rows = [
      { p: 0.5, lo: 0.4, hi: 0.6, typical: 0.2 },
      { p: 0.24, lo: 0.1, hi: 0.3, typical: 0.2 },
      { p: 0.24, lo: 0.235, hi: 0.25, typical: 0.2 },
      { p: 0.1, lo: 0.05, hi: 0.12, typical: 0.2 },
    ];
    expect(countAbove(rows)).toBe(2);
    expect(countAbove([])).toBe(0);
  });
  it("words the claim line for one and many", () => {
    expect(aboveLine(2, 7)).toBe("2 of 7 sit above their phase's typical rate.");
    expect(aboveLine(1, 1)).toBe("1 of 1 sits above their phase's typical rate.");
    expect(aboveLine(1, 7, "CD20")).toBe("1 of 7 running CD20 trials sits above their phase's typical rate.");
    expect(aboveLine(0, 1, "CD20")).toBe("0 of 1 running CD20 trial sit above their phase's typical rate.");
  });
});
