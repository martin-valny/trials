import { describe, expect, it } from "vitest";
import {
  drugLanes,
  figureSearch,
  headline,
  companyOptions,
  marginNotes,
  markState,
  parseFigureState,
  rowAccessibleName,
  rowForGene,
  rowsForTrial,
  rowViews,
  sourceLine,
  stopSummary,
  targetCompanies,
  cellMarks,
  type FigureState,
} from "../src/lib/pipeline";
import type { MarkState, PipelineFile, PipelineMark, PipelineRow } from "../src/types";
import { columnsFor } from "../src/components/pipeline/parts";
import { readFixture } from "./helpers";

const DEFAULT: FigureState = { disease: null, company: null, sort: "run", view: "phase" };

let seq = 0;
const mark = (extra: Partial<PipelineMark> & { s?: MarkState } = {}): PipelineMark => ({
  n: `NCT${String(++seq).padStart(8, "0")}`,
  c: 2,
  s: "fin",
  y: 2020,
  y2: 2022,
  dz: ["MS"],
  drug: "drugx",
  sp: 0,
  ...extra,
});
const many = (k: number, extra: Partial<PipelineMark> = {}): PipelineMark[] =>
  Array.from({ length: k }, () => mark(extra));

const row = (id: string, marks: PipelineMark[], extra: Partial<PipelineRow> = {}): PipelineRow => ({
  id,
  label: id.toUpperCase(),
  sub: "",
  family: "f1",
  order: 1,
  gene: null,
  related: [],
  marks,
  ...extra,
});

const file = (rows: PipelineRow[]): PipelineFile => ({
  generated_for: "2026-11-06",
  counts: { trials: 1000, targeted: 300, in_rows: 200, targeted_not_rowed: 100 },
  diseases: [
    { code: "MS", label: "Multiple sclerosis" },
    { code: "MG", label: "Myasthenia gravis" },
  ],
  families: [
    { id: "f1", label: "Family one", order: 1 },
    { id: "f2", label: "Family two", order: 2 },
  ],
  rows,
  sponsors: [
    { raw: "Roche", parent: "Roche", kind: "industry" },
    { raw: "Genentech", parent: "Roche", kind: "industry" },
    { raw: "Novartis Pharmaceuticals", parent: "Novartis", kind: "industry" },
    { raw: "Novartis AG", parent: "novartis", kind: "industry" },
    { raw: "Univ A", parent: "Univ A", kind: "academic" },
    { raw: "Univ B", parent: "Univ B", kind: "academic" },
  ],
  trials: {},
  unrowed: [],
});

describe("parseFigureState / figureSearch", () => {
  const f = file([row("a", many(1, { sp: 0 }))]);
  it("ignores unknown values", () => {
    const p = new URLSearchParams("disease=XYZ&sort=foo&view=bar&company=Nobody");
    expect(parseFigureState(p, f)).toEqual(DEFAULT);
    expect(parseFigureState(p, null)).toEqual(DEFAULT);
  });
  it("canonicalises the company", () => {
    expect(parseFigureState(new URLSearchParams("company=roche"), f).company).toBe("Roche");
    expect(parseFigureState(new URLSearchParams("company=%20NOVARTIS "), f).company).toBe("Novartis");
  });
  it("omits defaults and round-trips", () => {
    expect(figureSearch(DEFAULT)).toBe("");
    const s: FigureState = { disease: "MG", company: "Roche", sort: "adv", view: "disease" };
    const q = figureSearch(s);
    expect(q).toBe("disease=MG&company=Roche&sort=adv&view=disease");
    expect(parseFigureState(new URLSearchParams(q), f)).toEqual(s);
    expect(figureSearch({ ...DEFAULT, sort: "az" })).toBe("sort=az");
  });
});

describe("markState", () => {
  it("keeps advanced only for the disease it advanced in (R21)", () => {
    const m = mark({ s: "adv", si: ["MG"], dz: ["MS", "MG"] });
    expect(markState(m, "MS")).toBe("fin");
    expect(markState(m, "MG")).toBe("adv");
    expect(markState(m, null)).toBe("adv");
    expect(markState(mark({ s: "adv" }), "MS")).toBe("fin");
    expect(markState(mark({ s: "run" }), "MS")).toBe("run");
  });
});

describe("rowViews", () => {
  const f = file([
    row("old", [...many(12, { s: "fin" }), mark({ s: "run" })]),
    row("hot", [...many(3, { s: "run", sp: 2 }), mark({ s: "adv" })]),
    row("ms-only", many(2, { dz: ["MG"], s: "run", y: 2025 })),
    row("mid", [...many(2, { s: "run" }), ...many(2, { s: "adv" })]),
    row("none", []),
  ]);
  it("drops rows with no marks and filters by disease", () => {
    expect(rowViews(f, DEFAULT, 2026).map((v) => v.row.id)).not.toContain("none");
    const mg = rowViews(f, { ...DEFAULT, disease: "MG" }, 2026);
    expect(mg.map((v) => v.row.id)).toEqual(["ms-only"]);
  });
  it("flags historical rows and counts states", () => {
    const v = rowViews(f, DEFAULT, 2026);
    const old = v.find((x) => x.row.id === "old")!;
    expect(old.historical).toBe(true);
    expect(old.total).toBe(13);
    expect(old.run).toBe(1);
    expect(v.find((x) => x.row.id === "hot")!.historical).toBe(false);
    expect(v.find((x) => x.row.id === "hot")!.adv).toBe(1);
  });
  it("sorts", () => {
    const ids = (sort: FigureState["sort"]) =>
      rowViews(f, { ...DEFAULT, sort }, 2026).map((v) => v.row.id);
    expect(ids("run")[0]).toBe("hot");
    expect(ids("adv")[0]).toBe("mid");
    expect(ids("az")).toEqual(["hot", "mid", "ms-only", "old"]);
    expect(ids("new")[0]).toBe("ms-only");
  });
  it("puts the company's rows first, stably", () => {
    const g = file([
      row("a", many(3, { s: "run", sp: 2 })),
      row("b", many(2, { s: "run", sp: 0 })),
      row("c", many(1, { s: "run", sp: 1 })),
    ]);
    const v = rowViews(g, { ...DEFAULT, company: "Roche" }, 2026);
    expect(v.map((x) => x.row.id)).toEqual(["b", "c", "a"]);
    expect(v[0]!.hasCompany).toBe(true);
    expect(v[2]!.hasCompany).toBe(false);
  });
  it("lists industry companies by count, merging names that differ in case", () => {
    const g = file([
      row("a", [
        ...many(2, { sp: 2, s: "run" }),
        ...many(1, { sp: 3 }),
        ...many(4, { sp: 0 }),
        ...many(1, { sp: 4 }),
        ...many(1, { sp: 5 }),
      ]),
    ]);
    const v = rowViews(g, DEFAULT, 2026)[0]!;
    expect(v.companies.map((c) => [c.parent, c.n, c.run])).toEqual([
      ["Roche", 4, 0],
      ["Novartis", 3, 2],
    ]);
    expect(v.runningCompanies).toBe(1);
    expect(v.academic).toBe(2);
  });
  it("cellMarks follows the arrangement, oldest first, undated last", () => {
    const g = file([
      row("a", [
        mark({ c: 3, y: 2022 }),
        mark({ c: 3, y: null }),
        mark({ c: 3, y: 2010 }),
        mark({ c: 1, dz: ["MS", "MG"] }),
      ]),
    ]);
    const v = rowViews(g, DEFAULT, 2026)[0]!;
    expect(cellMarks(v, 3, DEFAULT).map((m) => m.y)).toEqual([2010, 2022, null]);
    expect(cellMarks(v, "MG", { ...DEFAULT, view: "disease" })).toHaveLength(1);
  });
});

describe("headline", () => {
  const f = file([
    row("a", [mark({ n: "NCT1", s: "run", c: 2 }), ...many(2, { s: "run" })]),
    row("b", [mark({ n: "NCT1", s: "run", c: 2 }), mark({ s: "adv" })]),
    row("c", [mark({ s: "fin" })], { family: "f2" }),
  ]);
  it("counts distinct trials", () => {
    const v = rowViews(f, DEFAULT, 2026);
    const h = headline(f, v, DEFAULT);
    expect(h.kind).toBe("field");
    expect(h.running).toBe(3);
    expect(h.advanced).toBe(1);
    expect(h.trials).toBe(5);
    expect(h.text.lead).toBe("3 targeted-drug trials are running.");
    expect(h.text.rest).toBe("Family one leads, with 3 of them; A alone has 3.");
  });
  it("names the row with most running trials under any sort", () => {
    const g = file([
      row("aaa", many(2, { s: "run" })),
      row("zzz", many(5, { s: "run", y: 2000 })),
      row("mmm", many(3, { s: "run", y: 2025 })),
    ]);
    for (const sort of ["az", "new", "adv", "run"] as const) {
      const s = { ...DEFAULT, sort };
      expect(headline(g, rowViews(g, s, 2026), s).text.rest).toBe("Family one leads, with 10 of them; ZZZ alone has 5.");
    }
  });
  it("names the disease and uses singulars", () => {
    const g = file([row("a", [mark({ s: "run", dz: ["MG"] })])]);
    const s = { ...DEFAULT, disease: "MG" };
    expect(headline(g, rowViews(g, s, 2026), s).text.lead).toBe("1 targeted-drug trial is running in MG.");
  });
  it("handles zero running under a disease", () => {
    const g = file([row("a", [mark({ s: "fin", dz: ["MG"] }), mark({ s: "stop", dz: ["MG"] })])]);
    const s = { ...DEFAULT, disease: "MG" };
    const h = headline(g, rowViews(g, s, 2026), s);
    expect(h.kind).toBe("none");
    expect(h.text.lead).toBe("No targeted-drug trials are running in MG;");
    expect(h.text.rest).toBe(" 2 finished or stopped.");
  });
  it("speaks for the company lens", () => {
    const g = file([
      row("a", [mark({ s: "run", sp: 0 }), mark({ s: "adv", sp: 1 }), mark({ s: "fin", sp: 2 })]),
      row("b", [mark({ s: "fin", sp: 0 })]),
      row("c", [mark({ s: "run", sp: 2 })]),
    ]);
    const s = { ...DEFAULT, company: "Roche" };
    const h = headline(g, rowViews(g, s, 2026), s);
    expect(h.kind).toBe("lens");
    expect(h.text.lead).toBe("Roche");
    expect(h.text.rest).toBe(": 3 trials across 2 target classes; 1 running, 1 advanced.");
    expect(h.trials).toBe(3);
  });
  it("uses singular lens wording and calm copy when the lens is empty", () => {
    const g = file([row("a", [mark({ s: "run", sp: 0 })])]);
    const s = { ...DEFAULT, company: "Roche" };
    expect(headline(g, rowViews(g, s, 2026), s).text.rest).toBe(
      ": 1 trial across 1 target class; 1 running, 0 advanced.",
    );
    const e = { ...DEFAULT, company: "Novartis" };
    const h = headline(g, rowViews(g, e, 2026), e);
    expect(h.kind).toBe("none");
    expect(h.text.lead).toBe("Nothing for Novartis");
  });
});

describe("marginNotes", () => {
  const f = file([
    row("crowd", [...many(6, { s: "run", sp: 0 }), ...many(2, { s: "run", sp: 2 })]),
    row("new", many(6, { y: 2025 })),
    row("adv", [...many(3, { s: "adv" }), ...many(3, { y: 2000 })]),
    row("stopped", [...many(4, { s: "stop", sp: 2 }), ...many(2, { s: "stop", sp: 0 }), mark({ y: 2000 })]),
    row("extra", many(2, { s: "run" })),
  ]);
  it("applies the rules in order on distinct rows", () => {
    const v = rowViews(f, DEFAULT, 2026);
    const n = marginNotes(v, DEFAULT, 2026);
    expect(n.size).toBe(4);
    expect(n.get("crowd")).toEqual({
      kicker: "Most crowded",
      text: "8 trials running, from 2 companies plus academic groups.",
    });
    expect(n.get("new")?.kicker).toBe("Newest wave");
    expect(n.get("new")?.text).toBe("6 of 6 trials started since 2022.");
    expect(n.get("adv")?.text).toBe("3 trials advanced to a later phase.");
    expect(n.get("stopped")?.text).toBe("6 stopped; 4 of them by Novartis. Reasons on the target page.");
  });
  it("never prints 0 companies", () => {
    const g = file([row("a", many(5, { s: "run", sp: 4 }))]); // academic sponsor only
    expect(marginNotes(rowViews(g, DEFAULT, 2026), DEFAULT, 2026).get("a")?.text).toBe(
      "5 trials running, all from academic groups or other sponsors.",
    );
  });
  it("respects minimums and the cap", () => {
    const g = file([row("a", many(4, { s: "run" })), row("b", many(2, { s: "adv" })), row("c", many(4, { s: "stop" }))]);
    expect(marginNotes(rowViews(g, DEFAULT, 2026), DEFAULT, 2026).size).toBe(0);
    const big = file(
      ["a", "b", "c", "d", "e"].map((id) => row(id, [...many(5, { s: "run", y: 2025 }), ...many(3, { s: "adv", y: 2025 }), ...many(5, { s: "stop", y: 2025 })])),
    );
    expect(marginNotes(rowViews(big, DEFAULT, 2026), DEFAULT, 2026).size).toBe(4);
  });
  it("is hidden with the company lens", () => {
    const s = { ...DEFAULT, company: "Roche" };
    expect(marginNotes(rowViews(f, s, 2026), s, 2026).size).toBe(0);
  });
  it("adds Spreading only in the disease arrangement", () => {
    const g = file([
      row("a", [mark({ s: "run", dz: ["MS"] }), mark({ s: "run", dz: ["MG"] }), mark({ s: "run", dz: ["NMOSD", "MS"] })]),
    ]);
    const d = { ...DEFAULT, view: "disease" as const };
    expect(marginNotes(rowViews(g, d, 2026), d, 2026, ["MS", "MG", "NMOSD"]).get("a")).toEqual({
      kicker: "Spreading",
      text: "Running in 3 diseases: MS, MG, NMOSD.",
    });
    expect(marginNotes(rowViews(g, DEFAULT, 2026), DEFAULT, 2026).has("a")).toBe(false);
  });
});

describe("companyOptions", () => {
  it("dedupes case-insensitively, industry first by trials, then others alphabetically", () => {
    const f = file([row("a", [...many(1, { sp: 2 }), ...many(1, { sp: 3 }), ...many(1, { sp: 0 }), mark({ sp: 5 }), mark({ sp: 4 })])]);
    expect(companyOptions(f)).toEqual(["Novartis", "Roche", "Univ A", "Univ B"]);
  });
});

describe("sourceLine and accessible name", () => {
  it("fills the numbers", () => {
    const f = file([row("a", many(3)), row("b", many(2))]);
    const v = rowViews(f, DEFAULT, 2026);
    const line = sourceLine(f, v);
    expect(line.startsWith("5 of 1,000 trials test a targeted drug in one of these 2 classes; 100 more targeted-drug trials sit in smaller classes (Methods);")).toBe(true);
    expect(line).toContain("ClinicalTrials.gov registered trials only");
  });
  it("names a row", () => {
    const f = file([row("cd20", [mark({ s: "run" }), mark({ s: "adv" }), mark({ s: "stop" })])]);
    expect(rowAccessibleName(rowViews(f, DEFAULT, 2026)[0]!)).toBe(
      "CD20: 3 trials, 1 running, 1 advanced, 1 stopped. Open target page.",
    );
  });
});

describe("target page helpers", () => {
  it("drugLanes pools small drugs", () => {
    const marks = [...many(5, { drug: "big" }), ...many(4, { drug: "Mid" }), ...many(2, { drug: "s1" }), mark({ drug: "s2" })];
    const lanes = drugLanes(marks, "CD20");
    expect(lanes.map((l) => [l.name, l.marks.length])).toEqual([["big", 5], ["Mid", 4], ["Other CD20", 3]]);
  });
  it("drugLanes merges a drug variant into the drug it starts with", () => {
    const marks = [...many(3, { drug: "efgartigimod" }), ...many(2, { drug: "Efgartigimod ph20" }), ...many(4, { drug: "other drug" }), mark({ drug: "efgartigimodx" })];
    const lanes = drugLanes(marks, "FcRn");
    expect(lanes.map((l) => [l.name, l.marks.length])).toEqual([["efgartigimod", 5], ["other drug", 4], ["Other FcRn", 1]]);
  });
  it("targetCompanies lists a drug variant under its root drug", () => {
    const f = file([]);
    const marks = [mark({ sp: 0, drug: "a" }), mark({ sp: 0, drug: "a ph20" }), mark({ sp: 0, drug: "a ph20" }), mark({ sp: 0, drug: "b" })];
    expect(targetCompanies(f, marks)[0]!.drugs).toEqual(["a", "b"]);
  });
  it("targetCompanies groups by parent with an academic tail", () => {
    const f = file([]);
    const marks = [mark({ sp: 0, s: "run", drug: "a" }), mark({ sp: 1, s: "adv", drug: "b" }), mark({ sp: 2, s: "fin" }), mark({ sp: 4 }), mark({ sp: 5 })];
    const c = targetCompanies(f, marks);
    expect(c.map((x) => x.parent)).toEqual(["Roche", "Novartis", "Academic and other"]);
    expect(c[0]!.marks.map((m) => m.s)).toEqual(["adv", "run"]);
    expect(c[0]!.run).toBe(1);
    expect(c[0]!.drugs.sort()).toEqual(["a", "b"]);
    expect(c[2]!.marks).toHaveLength(2);
  });
  it("stopSummary hides groups when Other is over 15%", () => {
    const f = file([]);
    const stops = (reasons: string[]) => reasons.map((r) => mark({ s: "stop" , n: `NCT-${r}-${Math.random()}` }));
    const mk = (reasons: string[]) => {
      const ms = stops(reasons);
      f.trials = Object.fromEntries(ms.map((m, i) => [m.n, { t: "t", why: "w", r: reasons[i] }]));
      return stopSummary(f, ms);
    };
    const ok = mk([...Array(9).fill("Safety"), "Other", "Not given"]);
    expect(ok.showGroups).toBe(true);
    expect(ok.groups[0]).toEqual(["Safety", 9]);
    expect(ok.stops).toHaveLength(11);
    expect(mk([...Array(4).fill("Safety"), "Other"]).showGroups).toBe(false);
  });
});

describe("fixture", () => {
  it("has the keys the types promise", () => {
    const f = readFixture<PipelineFile>("pipeline.json");
    expect(Object.keys(f).sort()).toEqual(["counts", "diseases", "families", "generated_for", "rows", "sponsors", "trials", "unrowed"]);
    expect(Object.keys(f.counts).sort()).toEqual(["in_rows", "targeted", "targeted_not_rowed", "trials"]);
    expect(Array.isArray(f.unrowed)).toBe(true);
    for (const sp of f.sponsors) {
      expect(typeof sp.raw).toBe("string");
      expect(["industry", "academic", "government", "other"]).toContain(sp.kind);
    }
    for (const r of f.rows) {
      for (const k of ["id", "label", "sub", "family", "order", "gene", "related", "marks"]) expect(r).toHaveProperty(k);
      expect(f.families.some((x) => x.id === r.family)).toBe(true);
      for (const m of r.marks) {
        for (const k of ["n", "c", "s", "y", "y2", "dz", "drug", "sp"]) expect(m).toHaveProperty(k);
        expect(f.sponsors[m.sp]).toBeDefined();
        expect(f.trials[m.n]?.t.length).toBeLessThanOrEqual(80);
      }
    }
    const stopped = Object.values(f.trials).filter((t) => t.r !== undefined);
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped.every((t) => "why" in t)).toBe(true);
  });
  it("parses and yields views", () => {
    const f = readFixture<PipelineFile>("pipeline.json");
    const v = rowViews(f, DEFAULT, 2026);
    expect(v.length).toBeGreaterThan(0);
    expect(headline(f, v, DEFAULT).trials).toBeGreaterThan(0);
    expect(companyOptions(f).length).toBeGreaterThan(0);
  });
});

describe("hand-offs", () => {
  const f = readFixture<PipelineFile>("pipeline.json");
  it("rowForGene finds the row for a gene, the first in figure order when several share it", () => {
    expect(rowForGene(f, "MS4A1")?.id).toBe("cd20");
    // row.order is the order inside a family: CD19 CAR-T has order 1 but sits in a later family
    expect(f.rows.filter((r) => r.gene === "CD19").map((r) => r.id)).toEqual(["cd19", "cd19-car-t"]);
    expect(rowForGene(f, "CD19")?.id).toBe("cd19");
    expect(rowForGene(f, "NOPE")).toBeNull();
  });
  it("rowsForTrial follows figure order, not the order within a family", () => {
    const two = structuredClone(f);
    const m = mark({ n: "NCT00000555" });
    two.rows.find((r) => r.id === "cd19-car-t")!.marks.push(m);
    two.rows.find((r) => r.id === "cd19")!.marks.push({ ...m });
    expect(rowsForTrial(two, m.n).map((r) => r.id)).toEqual(["cd19", "cd19-car-t"]);
  });
  it("rowsForTrial lists every row a trial sits in", () => {
    const two = structuredClone(f);
    const m = two.rows[0]!.marks[0]!;
    two.rows[1]!.marks.push({ ...m });
    expect(rowsForTrial(two, m.n).map((r) => r.id)).toEqual([two.rows[0]!.id, two.rows[1]!.id]);
    expect(rowsForTrial(f, "NCT00000000")).toEqual([]);
  });
});

describe("columnsFor", () => {
  it("follows pipeline.json's disease order and shortens long codes for phones", () => {
    const g = file([row("a", [])]);
    g.diseases = [
      { code: "ZED", label: "Zed disease" },
      { code: "ALPHA1", label: "Alpha" },
      { code: "MS", label: "MS" },
    ];
    const cols = columnsFor(g, "disease");
    expect(cols.map((c) => c.key)).toEqual(["ZED", "ALPHA1", "MS"]);
    expect(cols.map((c) => c.short)).toEqual(["ZED", "ALP", "MS"]);
  });
});
