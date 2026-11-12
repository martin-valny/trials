/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isIntroFile } from "../src/data";
import { buildViews, cloudPositions, introPairs, visibleViews, VIEW_TEXT, type ViewKey } from "../src/lib/intro";
import type { IntroFile } from "../src/types";

const fixture = (): Record<string, any> => JSON.parse(readFileSync("tests/fixtures/data/intro.json", "utf8"));

describe("isIntroFile", () => {
  it("accepts the fixture", () => {
    expect(isIntroFile(fixture())).toBe(true);
  });
  it("rejects ragged columns", () => {
    const f = fixture();
    f.trials.risk.pop();
    expect(isIntroFile(f)).toBe(false);
  });
  it("rejects non-objects and missing columns", () => {
    expect(isIntroFile(null)).toBe(false);
    const f = fixture();
    delete f.trials.dz;
    expect(isIntroFile(f)).toBe(false);
  });
});

describe("intro layouts", () => {
  const fx = (): IntroFile => fixture() as IntroFile;

  /** 12 trials: marks on two rows, one multi-approach, changes in two bins, risk on some. */
  const hand = (): IntroFile => {
    const n = 12;
    const ids = Array.from({ length: n }, (_, i) => `NCT${i}`);
    const marks: IntroFile["trials"]["marks"] = ids.map(() => []);
    marks[0] = [[0, 3, "fin"]]; // succeeded trial whose only mark is fin
    marks[1] = [[0, 2, "run"], [1, 1, "stop"]]; // two rows: appears once, on row 0
    marks[2] = [[1, 4, "adv"]];
    marks[3] = [[1, 1, "unk"]];
    const outcome = ids.map((_, i) => (i === 0 ? "succeeded" : "running")) as IntroFile["trials"]["outcome"];
    return {
      generated_for: "2026-11-04",
      trial_count: n,
      approaches: [
        { key: "targeted", label: "Targeted drugs" },
        { key: "cell", label: "Cell & transplant" },
        { key: "unclassified", label: "Unclassified" },
      ],
      rows: [
        { id: "cd20", label: "CD20" },
        { id: "fcrn", label: "FcRn" },
      ],
      typical: 0.2,
      trials: {
        id: ids,
        x: ids.map((_, i) => (i % 4) * 0.3),
        y: ids.map((_, i) => Math.floor(i / 4) * 0.3),
        outcome,
        approaches: ids.map((_, i) => (i === 1 ? ["targeted", "cell"] : i < 6 ? ["targeted"] : [])),
        start: ids.map((_, i) => (i === 5 ? 1980 : i === 6 ? 2090 : 2010 + i)),
        dz: ids.map((_, i) => (i < 3 ? ["ms"] : [])),
        marks,
        risk: ids.map((_, i) => (i >= 6 ? 0.1 * (i - 5) : null)),
        change: ids.map((_, i) => (i === 7 ? ["dates", "date_slip_ge_90d"] : i === 8 ? ["dates", null] : i === 9 ? ["status", "status_change"] : null)),
      },
    };
  };

  const sizes: [number, number][] = [[900, 430], [343, 380]];
  const files = (): [string, IntroFile][] => [["fixture", fx()], ["hand", hand()]];

  it("every view has one dot per trial", () => {
    for (const [, f] of files()) {
      const v = buildViews(f, [{ target: "cd20", disease: "all" }], 900, 430);
      for (const k of Object.keys(v) as ViewKey[]) expect(v[k].dots).toHaveLength(f.trials.id.length);
    }
  });

  it("no dot is outside the canvas", () => {
    for (const [, f] of files()) {
      for (const [w, h] of sizes) {
        const v = buildViews(f, [{ target: "cd20", disease: "all" }], w, h);
        for (const k of Object.keys(v) as ViewKey[]) {
          for (const d of v[k].dots) {
            expect(d.x).toBeGreaterThanOrEqual(0);
            expect(d.x).toBeLessThanOrEqual(w);
            expect(d.y).toBeGreaterThanOrEqual(0);
            expect(d.y).toBeLessThanOrEqual(h);
          }
        }
      }
    }
  });

  it("cloud relaxation leaves no two dots closer than 0.9 x min distance", () => {
    for (const [, f] of files()) {
      const [w, h] = [900, 430];
      const md = Math.max(4, Math.min(7, Math.sqrt((0.3 * w * h) / f.trials.id.length)));
      const c = cloudPositions(f, w, h);
      for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) expect(Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y)).toBeGreaterThanOrEqual(0.9 * md);
    }
  });

  it("pipeline paints the row state, not the trial outcome", () => {
    const f = hand();
    const d = buildViews(f, [], 900, 430).pipeline.dots;
    expect(f.trials.outcome[0]).toBe("succeeded");
    expect(d[0].paint).toBe("fin");
    expect(d[0].a).toBe(1);
  });

  it("a trial on two rows appears once, on its highest shown row", () => {
    const f = hand();
    const d = buildViews(f, [], 900, 430).pipeline.dots;
    expect(d[1].a).toBe(1);
    expect(d[1].paint).toBe("stop"); // FcRn has more marked trials (3) than CD20 (2), so it ranks first
    expect(d.filter((x) => x.a === 1)).toHaveLength(4);
    expect(d.filter((x) => x.paint === "ghost")).toHaveLength(8);
  });

  it("diligence skips a pair whose target is not a row", () => {
    const f = hand();
    const v = buildViews(f, [{ target: "gone", disease: "all" }, { target: "cd20", disease: "ms" }, { target: "cd20", disease: "nope" }], 900, 430).diligence;
    expect(v.labels.map((l) => l.text)).toEqual(["CD20 · ms"]);
    expect(v.dots.filter((x) => x.a === 1)).toHaveLength(2);
    expect(introPairs(f, [{ target: "gone", disease: "all" }])).toEqual([]);
  });

  it("approaches: multi-approach trial goes to More than one", () => {
    const f = hand();
    const v = buildViews(f, [], 900, 430).approaches;
    expect(v.dots[1].paint).toBe("multi");
    expect(v.dots[0].paint).toBe("ap:targeted");
    expect(v.dots[11].paint).toBe("ap:unclassified");
    expect(v.labels.some((l) => l.text === "More than one approach")).toBe(true);
    expect(v.dots[1].x).toBeGreaterThan(v.dots[11].x);
  });

  it("changes: notable beats routine and an empty week shows the message", () => {
    const f = hand();
    const v = buildViews(f, [], 900, 430).changes;
    expect(v.dots[7].paint).toBe("changed");
    expect(v.dots[7].r).toBe(6);
    expect(v.dots[8].paint).toBe("changed-ring");
    expect(v.dots[8].r).toBe(5);
    const t = v.labels.map((l) => l.text);
    expect(t).toContain("2 trials · 1 slipped 90+ days");
    expect(t).toContain("1 trial · 1 notable");
    expect(t).toContain("3 of 12 trials changed in the last 7 days · solid = flagged as notable");
    const e = hand();
    e.trials.change = e.trials.change.map(() => null);
    expect(buildViews(e, [], 900, 430).changes.labels.map((l) => l.text)).toContain("No changes in the last 7 days");
  });

  it("trials clamps years and watchlist clamps risk", () => {
    const f = hand();
    const v = buildViews(f, [], 900, 430);
    expect(v.trials.dots[5].x).toBeLessThan(v.trials.dots[0].x);
    expect(v.trials.dots[6].x).toBeGreaterThan(v.trials.dots[0].x);
    expect(v.watchlist.dots.filter((d) => d.a === 1)).toHaveLength(6);
    expect(v.watchlist.rules.some((r) => r.kind === "tick")).toBe(true);
    expect(v.watchlist.labels.map((l) => l.text)).toContain("typical 20%");
  });

  it("visibleViews drops diligence without pairs and watchlist without risk", () => {
    const f = hand();
    expect(visibleViews(f, [{ target: "cd20", disease: "all" }])).toHaveLength(7);
    expect(visibleViews(f, [])).not.toContain("diligence");
    f.trials.risk = f.trials.risk.map(() => null);
    expect(visibleViews(f, [{ target: "cd20", disease: "all" }])).not.toContain("watchlist");
    expect(Object.keys(VIEW_TEXT)).toHaveLength(7);
  });
});
