/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isIntroFile } from "../src/data";
import { APPROACH_NOTE, buildViews, buildViewsRaw, captionText, cloudPositions, introPairs, visibleViews, VIEW_TEXT, type ViewKey } from "../src/lib/intro";
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

const BIN_NAMES = ["Dates", "Status", "Sites & countries", "Enrollment", "Outcomes", "Other details"];
const l12 = (l: { size?: number }) => (l.size ?? 12);

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

  const sizes: [number, number][] = [[900, 430], [343, 380], [0, 0], [0, 300], [300, 0]];
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
            expect(Number.isFinite(d.x) && Number.isFinite(d.y)).toBe(true);
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
    expect(t).toContain("2 trials");
    expect(t).toContain("1 slipped 90+ days");
    expect(t).toContain("1 trial");
    expect(t).toContain("1 notable");
    expect(t).not.toContain("2 trials · 1 slipped 90+ days");
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

  it("300 trials in one pipeline cell stay inside it at 343 x 380", () => {
    const f = hand();
    const n = 300;
    f.trials = {
      id: Array.from({ length: n }, (_, i) => `N${i}`), x: Array.from({ length: n }, (_, i) => i), y: Array.from({ length: n }, () => 0),
      outcome: Array(n).fill("running"), approaches: Array(n).fill([]), start: Array(n).fill(2020), dz: Array(n).fill([]),
      marks: Array.from({ length: n }, (_, i) => (i < 150 ? [[0, 1, "run"]] : [[1, 1, "run"]])), risk: Array(n).fill(null), change: Array(n).fill(null),
    } as IntroFile["trials"];
    const [w, h] = [343, 380];
    const d = buildViews(f, [], w, h).pipeline.dots.filter((x) => x.a === 1);
    const top = 40, nRows = 2, rowH = (h - top) / nRows, labW = Math.min(130, w * 0.22), colW = (w - labW) / 4;
    for (const p of d) {
      const rk = Math.floor((p.y - top) / rowH);
      expect(rk).toBeGreaterThanOrEqual(0);
      expect(rk).toBeLessThan(nRows);
      expect(p.x).toBeGreaterThanOrEqual(labW + 6);
      expect(p.x).toBeLessThanOrEqual(labW + colW - 6);
    }
    expect(d.length).toBeGreaterThan(100);
  });

  it("40 changed trials in one bin stay inside it at 343 wide (3 x 2 bins, no side inset)", () => {
    const f = hand();
    const n = 40;
    f.trials = {
      id: Array.from({ length: n }, (_, i) => `N${i}`), x: Array.from({ length: n }, (_, i) => i), y: Array.from({ length: n }, () => 0),
      outcome: Array(n).fill("running"), approaches: Array(n).fill([]), start: Array(n).fill(2020), dz: Array(n).fill([]),
      marks: Array(n).fill([]), risk: Array(n).fill(null), change: Array(n).fill(["dates", null]),
    } as IntroFile["trials"];
    const w = 343, cw = w / 3;
    const d = buildViewsRaw(f, [], w, 380).changes.dots.filter((x) => x.a === 1);
    expect(d.length).toBeGreaterThan(10);
    for (const p of d) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(0);
      expect(p.x + p.r).toBeLessThanOrEqual(cw);
    }
  });


  /** 3000 trials with the real column sizes: Non-drug care 1,199 and Targeted 1,014 are the tall ones. */
  const bigApproaches = (): IntroFile => {
    const f = fx();
    const sizes: [string[], number][] = [[["targeted"], 1014], [["cell"], 150], [["plasma"], 100], [["tolerisation"], 60], [["diffuse"], 50], [["nondrug"], 1199], [["unclassified"], 400], [["targeted", "cell"], 27]];
    const ap = sizes.flatMap(([a, c]) => Array.from({ length: c }, () => a));
    const n = ap.length;
    f.trials = {
      id: ap.map((_, i) => `N${i}`), x: ap.map((_, i) => i % 50), y: ap.map((_, i) => Math.floor(i / 50)),
      outcome: Array(n).fill("running"), approaches: ap, start: Array(n).fill(2020), dz: Array(n).fill([]),
      marks: Array(n).fill([]), risk: Array(n).fill(null), change: Array(n).fill(null),
    } as IntroFile["trials"];
    f.trial_count = n;
    return f;
  };

  it("approaches: nothing is off-canvas before the final clamp, at 900 x 430 and 343 x 380", () => {
    for (const [w, h] of [[900, 430], [343, 380], [343, 300]] as const) {
      const v = buildViewsRaw(bigApproaches(), [], w, h).approaches;
      for (const d of v.dots) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(w);
        expect(d.y - d.r).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThanOrEqual(h);
      }
    }
  });

  it("approaches: column heights stay proportional (1,199 is taller than 1,014) on the phone", () => {
    const f = bigApproaches();
    const v = buildViewsRaw(f, [], 343, 380).approaches;
    const top = (from: number, to: number) => Math.min(...v.dots.slice(from, to).map((d) => d.y));
    const targeted = top(0, 1014), nondrug = top(1374, 2573), unclassified = top(2573, 2973);
    expect(nondrug).toBeLessThan(targeted);
    expect(targeted).toBeLessThan(unclassified);
  });

  it("approaches: the note is not on the canvas; names are dropped when narrow and wrap when wide", () => {
    const f = bigApproaches();
    const narrow = buildViewsRaw(f, [], 343, 380).approaches.labels;
    expect(narrow.map((l) => l.text)).not.toContain(APPROACH_NOTE);
    expect(narrow.some((l) => l.text === "Non-drug care")).toBe(false);
    expect(narrow.map((l) => l.text)).toContain("1,199");
    const wide = buildViewsRaw(f, [], 900, 430).approaches.labels;
    expect(wide.map((l) => l.text)).not.toContain(APPROACH_NOTE);
    const name = wide.find((l) => l.text === "Broad immunomodulators")!;
    expect(name.maxW).toBeGreaterThan(40);
    expect(name.maxW).toBeLessThan(900 / 8 + 14);
    const count = wide.find((l) => l.text === "50")!;
    expect(count.y).toBeLessThan(name.y);
  });

  it("changes: below 500px wide, bins are 3 x 2 and the labels sit under their own bubble", () => {
    const f = hand();
    const v = buildViewsRaw(f, [], 343, 380).changes;
    const names = v.labels.filter((l) => BIN_NAMES.includes(l.text));
    expect(names.map((l) => l.x)).toEqual([343 / 6, 343 / 2, (343 * 5) / 6, 343 / 6, 343 / 2, (343 * 5) / 6]);
    expect(names[3].y).toBeGreaterThan(names[0].y + 40);
    for (const l of v.labels) expect(l.size ?? 12).toBeGreaterThanOrEqual(12);
    for (const d of v.dots.filter((x) => x.a === 1)) expect(d.y + d.r).toBeLessThan(380 * 0.8);
  });

  it("changes: the label block under each bubble is derived from the bubble, never inside it", () => {
    const f = hand();
    for (const [w, h] of [[900, 430], [343, 380], [343, 300]] as const) {
      const v = buildViewsRaw(f, [], w, h).changes;
      const lowest = Math.max(...v.dots.filter((d) => d.a === 1 && d.y < h * 0.8).map((d) => d.y + d.r));
      const first = v.labels.find((l) => l.text === "Dates")!;
      expect(first.y - (l12(first))).toBeGreaterThan(lowest - 100);
      const summary = v.labels.find((l) => l.x === 0);
      if (summary) expect(summary.y).toBeGreaterThan(Math.max(...v.labels.filter((l) => l !== summary && l.x > 0).map((l) => l.y)));
    }
  });

  it("changes: the bins are centred in the space above the grid band", () => {
    const f = hand();
    const n = 360;
    f.trials = {
      id: Array.from({ length: n }, (_, i) => `N${i}`), x: Array.from({ length: n }, (_, i) => i), y: Array(n).fill(0),
      outcome: Array(n).fill("running"), approaches: Array(n).fill([]), start: Array(n).fill(2020), dz: Array(n).fill([]),
      marks: Array(n).fill([]), risk: Array(n).fill(null),
      change: Array.from({ length: n }, (_, i) => [["dates", "status", "sites", "enrollment", "outcomes", "other"][i % 6], "date_slip_ge_90d"]),
    } as IntroFile["trials"];
    const [w, h] = [890, 400];
    const v = buildViewsRaw(f, [], w, h).changes;
    const summary = v.labels.find((l) => l.x === 0)!;
    const bins = v.labels.filter((l) => l !== summary);
    const topGap = Math.min(...v.dots.filter((d) => d.a === 1).map((d) => d.y - d.r));
    const bottomGap = summary.y - 12 - Math.max(...bins.map((l) => l.y));
    expect(topGap).toBeGreaterThan(0);
    expect(Math.abs(topGap - bottomGap)).toBeLessThan(40);
  });

  it("diligence: a target with an all memo is one cluster with every trial on its row", () => {
    const f = hand();
    const v = buildViewsRaw(f, [{ target: "cd20", disease: "ms" }, { target: "cd20", disease: "all" }, { target: "fcrn", disease: "all" }], 900, 430).diligence;
    const names = v.labels.filter((l) => l.weight === 700).map((l) => l.text);
    expect(names).toEqual(["CD20 · all", "FcRn · all"]);
    expect(v.dots.filter((d) => d.a === 1)).toHaveLength(4);
  });

  it("diligence: the name sits under the cluster and +N more is its own muted line below", () => {
    const f = hand();
    const n = 3000;
    f.trials = {
      id: Array.from({ length: n }, (_, i) => `N${i}`), x: Array(n).fill(0), y: Array(n).fill(0), outcome: Array(n).fill("running"),
      approaches: Array(n).fill([]), start: Array(n).fill(2020), dz: Array(n).fill([]), marks: Array(n).fill([[0, 1, "run"]]), risk: Array(n).fill(null), change: Array(n).fill(null),
    } as IntroFile["trials"];
    const v = buildViewsRaw(f, [{ target: "cd20", disease: "all" }], 343, 380).diligence;
    const lit = v.dots.filter((d) => d.a === 1);
    const lowest = Math.max(...lit.map((d) => d.y + d.r));
    const name = v.labels.find((l) => l.text === "CD20 · all")!;
    const more = v.labels.find((l) => /^\+\d+ more$/.test(l.text))!;
    expect(more).toBeDefined();
    expect(more.tone).toBe("muted");
    expect(name.y - 12).toBeGreaterThanOrEqual(lowest - 1);
    expect(more.y).toBeGreaterThan(name.y + 12);
  });

  it("watchlist: the dashed tick runs up to just under its label", () => {
    const f = hand();
    const v = buildViewsRaw(f, [], 900, 430).watchlist;
    const tick = v.rules.find((r) => r.kind === "tick")!;
    const label = v.labels.find((l) => l.text === "typical 20%")!;
    expect(tick.y - tick.length).toBeGreaterThan(label.y);
    expect(tick.y - tick.length).toBeLessThanOrEqual(label.y + 8);
  });

  it("trials: the first year reads <=1995 at the left edge, never a centred 1995", () => {
    const f = hand();
    for (const w of [900, 343]) {
      const t = buildViewsRaw(f, [], w, 380).trials.labels;
      const first = t.find((l) => l.text === "≤1995")!;
      expect(first.x).toBe(0);
      expect(first.align ?? "left").toBe("left");
      expect(t.map((l) => l.text)).not.toContain("1995");
    }
  });

  it("trials: below 500px wide, two start years share a column", () => {
    const f = hand();
    f.trials.start = f.trials.start.map((_, i) => (i === 0 ? 2011 : i === 1 ? 2012 : i === 2 ? 2013 : 2020));
    const colW = 343 / Math.ceil(33 / 2);
    const n = buildViewsRaw(f, [], 343, 380).trials.dots;
    expect(Math.floor(n[0].x / colW)).toBe(Math.floor(n[1].x / colW));
    expect(Math.floor(n[2].x / colW)).not.toBe(Math.floor(n[1].x / colW));
    const wide = buildViewsRaw(f, [], 900, 380).trials.dots;
    expect(Math.floor(wide[0].x / (900 / 33))).not.toBe(Math.floor(wide[1].x / (900 / 33)));
  });

  it("caption names the colour that is painted: Red in light, Orange in dark", () => {
    expect(captionText("pipeline", "light")).toBe("Trials sorted onto their drug target's row and phase. Red ones moved on to the next phase.");
    expect(captionText("pipeline", "dark")).toBe("Trials sorted onto their drug target's row and phase. Orange ones moved on to the next phase.");
    expect(captionText("trials", "dark")).toBe(VIEW_TEXT.trials.caption);
  });


  it("approaches: names appear only where the longest word fits its column (668 wide drops them, 900 keeps them)", () => {
    const f = bigApproaches();
    expect(buildViewsRaw(f, [], 668, 330).approaches.labels.some((l) => l.text === "Non-drug care")).toBe(false);
    expect(buildViewsRaw(f, [], 900, 430).approaches.labels.some((l) => l.text === "Non-drug care")).toBe(true);
  });

  it("changes: 668 wide uses three by two bins so no line is cut", () => {
    const f = hand();
    const names = buildViewsRaw(f, [], 668, 330).changes.labels.filter((l) => BIN_NAMES.includes(l.text));
    expect(new Set(names.map((l) => l.x)).size).toBe(3);
    expect(names[0].maxW).toBeGreaterThan(200);
  });

  it("diligence: with no height for a label under each cluster, clusters sit beside their labels in two columns", () => {
    const f = fx();
    const pairs = f.rows.map((r) => ({ target: r.id, disease: "all" }));
    const v = buildViewsRaw(f, pairs, 343, 235).diligence;
    const names = v.labels.filter((l) => l.weight === 700);
    expect(names.length).toBe(introPairs(f, pairs).length);
    expect(new Set(names.map((l) => l.x)).size).toBe(2);
    expect(names.every((l) => (l.align ?? "left") === "left")).toBe(true);
    const lit = v.dots.filter((d) => d.a === 1);
    expect(lit.length).toBeGreaterThan(0);
    for (const d of lit) expect(d.y).toBeLessThanOrEqual(235);
    // a cluster never overlaps its own label
    for (const n of names) for (const d of lit) if (Math.abs(d.y - n.y) < 8) expect(d.x + d.r).toBeLessThan(n.x);
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
