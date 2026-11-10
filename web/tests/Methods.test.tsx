import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Methods } from "../src/components/Methods";
import type { ExplorerFile, ExplorerTrial, Meta, RiskFile, RiskMetrics, RiskModelInfo } from "../src/types";
import { readFixture, renderAt, stubFetch } from "./helpers";

test("methods lists conditions from meta and limitations", async () => {
  stubFetch();
  renderAt(<Methods />);
  const meta = readFixture<Meta>("meta.json");
  for (const c of meta.conditions) expect(await screen.findByText(c)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Methods" })).toBeInTheDocument();
  expect(screen.getByText(/Registry data lags/)).toBeInTheDocument();
  expect(screen.getByText(/self-reported/)).toBeInTheDocument();
});

test("methods still renders without meta", async () => {
  stubFetch({ "meta.json": 404 });
  renderAt(<Methods />);
  expect(await screen.findByText(/condition list is unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/self-reported/)).toBeInTheDocument();
});

test("methods has map section with success definition", async () => {
  stubFetch();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const { container } = renderAt(<Methods />, "/methods#map");
  const h = await screen.findByRole("heading", { name: "How the map is made" });
  expect(h.closest("section")).toHaveAttribute("id", "map");
  expect(container.querySelector("#map")).not.toBeNull();
  expect(screen.getByText(/had no Phase 3 or 4 trial in the same disease before it started/)).toBeInTheDocument();
  expect(screen.getByText(/higher-phase trial of the same drug in the same disease/)).toBeInTheDocument();
  expect(screen.getByText(/another disease within this area is deliberately not counted/)).toBeInTheDocument();
  expect(screen.getByText(/share any of its drugs/)).toBeInTheDocument();
  expect(screen.getByText(/10,000 shuffles/)).toBeInTheDocument();
  expect(screen.getByText(/below 0\.025/)).toBeInTheDocument();
  expect(screen.getByText(/at least one drug in an experimental arm/)).toBeInTheDocument();
  expect(screen.getByText(/Phase 3-only and Phase 4 trials get no success label/)).toBeInTheDocument();
  expect(
    screen.getByText("Recently completed trials have had little time to move on, so recent years undercount success."),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/successful/i);
  expect(scroll).toHaveBeenCalled();
});

test("scrolls again after meta has loaded", async () => {
  stubFetch();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  renderAt(<Methods />, "/methods#map");
  await screen.findByText(readFixture<Meta>("meta.json").conditions[0]);
  expect(scroll.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test("methods states the mechanism source, licence, coverage, weight, counting rule and clusters", async () => {
  stubFetch();
  renderAt(<Methods />, "/methods#map");
  const text = () => document.body.textContent ?? "";
  // Cluster parameters come from explorer.json's method block.
  expect(await screen.findByText(/min_cluster_size 25/)).toBeInTheDocument();
  expect(text()).toMatch(/min_samples 10/);
  expect(screen.getByRole("link", { name: "ChEMBL" })).toHaveAttribute("href", "https://www.ebi.ac.uk/chembl/");
  expect(screen.getByRole("link", { name: "CC BY-SA 3.0" })).toBeInTheDocument();
  expect(text()).toMatch(/1,112 of 1,314 drug-bearing trials \(84\.6%\)/);
  expect(text()).toMatch(/201 mechanism classes/);
  expect(text()).toMatch(/Targeted drugs: 1,062 trials/);
  expect(text()).toMatch(/Not yet categorised: 570\./);
  expect(text()).toMatch(/names not yet categorised \(449, of which 13 have no experimental treatment listed\)/);
  expect(text()).toMatch(/weight 1\.0/);
  expect(screen.getByRole("link", { name: /weight research note/ })).toHaveAttribute(
    "href",
    expect.stringContaining("docs/superpowers/research/2026-11-06-mechanism-weight.md"),
  );
  expect(text()).toMatch(/counts in each group it touches/);
  expect(text()).toMatch(/HDBSCAN/);
  expect(text()).toMatch(/at least 25% of all its members/);
  expect(text()).toMatch(/What is not mapped/);
  // Five feature groups now, mechanism among them.
  expect(text()).toMatch(/Five groups of features/);
});

test("methods: the statistic leaves out mechanism; no percentage under 10; cluster anchors and thresholds", async () => {
  stubFetch();
  renderAt(<Methods />, "/methods#map");
  await screen.findByText(/min_cluster_size 25/);
  const text = document.body.textContent ?? "";
  expect(text).toMatch(/disease, treatment type, molecule and population only/);
  expect(text).toMatch(/By mechanism view/);
  expect(text).toMatch(/lift of 1\.32 \(shuffled labels 0\.62–1\.41,\s+p = 0\.061\)/);
  expect(text).toMatch(/would give 0\.71 \(p = 0\.94\)/);
  expect(text).toMatch(/shows no\s+percentage, only an outline bar, the counts/);
  expect(text).toMatch(/member nearest the cluster's median position/);
  // Thresholds come from explorer.json method.clusters.
  expect(text).toMatch(/at least 60% of the members/);
  expect(text).toMatch(/at least 15% of the members/);
});

test("Methods describes treatments without a molecular target", async () => {
  stubFetch();
  renderAt(<Methods />, "/methods#map");
  const h = await screen.findByRole("heading", { name: "Treatments without a molecular target" });
  expect(h).toBeInTheDocument();
  const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
  expect(text).toMatch(/Open Targets/);
  expect(text).toMatch(/ChEMBL/);
  expect(text).toMatch(/no target/i);
  expect(text).toMatch(/MeSH/);
  expect(text).toMatch(/E02/);
  for (const label of [
    "Targeted drugs",
    "Cell & transplant",
    "Antibody & plasma",
    "Tolerisation",
    "Broad immunomodulators",
    "Non-drug care",
    "Not yet categorised",
  ])
    expect(text).toContain(label);
  expect(text).toMatch(/counted for the drug that advanced/);
  expect(text).toMatch(/Thought to work by:/);
  // Coverage restated as two numbers.
  expect(text).toMatch(/1,121 of 1,314 drug-bearing trials \(85\.3%\)/);
  expect(text).toMatch(/2,156 of 2,987 trials \(72\.2%\)/);
  expect(text).toMatch(/Sorensen/);
});

test("Methods lists the not-yet-categorised names with counts, grouped, and links each group to the map", async () => {
  const f = readFixture<ExplorerFile>("explorer.json");
  const mk = (i: number, extra: Partial<ExplorerTrial>): ExplorerTrial => ({
    ...f.trials[0]!,
    nct_id: `NCT7000000${i}`,
    approaches: ["unclassified"],
    kinds: [],
    unsorted: [],
    ...extra,
  });
  const names = Array.from({ length: 12 }, (_, i) => `mystery drug ${i}`);
  const trials = [...f.trials, ...names.map((n, i) => mk(i, { unsorted: [n] })), mk(20, { unsorted: ["mystery drug 0"] }), mk(21, {})];
  stubFetch({ "explorer.json": { ...f, trials } });
  renderAt(<Methods />, "/methods#not-yet-categorised");
  const group = await screen.findByRole("region", { name: "Names not yet categorised" });
  const rows = within(group).getAllByRole("listitem");
  expect(rows).toHaveLength(10);
  expect(rows[0]).toHaveTextContent("mystery drug 0 2 trials");
  await userEvent.click(within(group).getByRole("button", { name: /^Show all \d+$/ }));
  expect(within(group).getAllByRole("listitem").length).toBeGreaterThanOrEqual(12);
  expect(within(group).getByRole("link", { name: "List these trials →" }).getAttribute("href")).toMatch(
    /^\/trials\?nct=NCT70000000/,
  );
  expect(screen.getByRole("region", { name: "No experimental treatment listed" })).toBeInTheDocument();
});

test("Methods has the six sections with their ids", async () => {
  stubFetch({
    "pipeline.json": {
      ...readFixture<Record<string, unknown>>("pipeline.json"),
      unrowed: [
        { class: "Symptomatic agent", trials: 12, reason: "symptomatic, not a disease target" },
        { class: "DNA inhibitor", trials: 5, reason: "conditioning chemotherapy" },
      ],
    },
  });
  const { container } = renderAt(<Methods />, "/methods");
  await screen.findByRole("heading", { name: "Advanced to next phase, and its time bias" });
  for (const id of ["advanced", "registry-only", "rows-and-companies", "unrowed", "not-yet-categorised", "map-statistic"])
    expect(container.querySelector(`#${id}`), id).not.toBeNull();

  const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
  expect(within(container.querySelector("#advanced")! as HTMLElement).getByText(/can't have advanced yet/)).toBeInTheDocument();
  expect(within(container.querySelector("#registry-only")! as HTMLElement).getByText(/registered/)).toBeInTheDocument();
  const rows = container.querySelector("#rows-and-companies") as HTMLElement;
  for (const path of ["config/pipeline/rows.csv", "config/pipeline/background.csv", "config/sponsors/parents.csv"])
    expect(rows.textContent).toContain(path);
  expect(rows.textContent).toContain("NCT00168766");
  expect(rows.textContent).toContain("NCT00771043");
  expect(rows.textContent).toMatch(/comparator/);
  const un = await within(container.querySelector("#unrowed") as HTMLElement).findByText(/Symptomatic agent/);
  expect(un.closest("li")?.textContent).toMatch(/12 trials/);
  expect(text).toMatch(/not shown as a row/);
  const stat = container.querySelector("#map-statistic") as HTMLElement;
  expect(stat.textContent).toMatch(/p-value/);
  expect(stat.textContent).toMatch(/10,000 shuffles/);
});

test("the map statistic section points to the similarity map", async () => {
  stubFetch();
  renderAt(<Methods />, "/methods");
  const link = await screen.findByRole("link", { name: /Similarity map \(experimental\)/ });
  expect(link).toHaveAttribute("href", "/explore");
  expect(link.closest("section")).toHaveAttribute("id", "map-statistic");
});

test("Methods explains what approved means for a disease", async () => {
  stubFetch();
  const { container } = renderAt(<Methods />, "/methods#approved");
  const h = await screen.findByRole("heading", { name: "Approved for this disease" });
  const section = h.closest("section") as HTMLElement;
  expect(section).toHaveAttribute("id", "approved");
  expect(section).toHaveAttribute("aria-labelledby", "approved-h");
  expect(container.querySelector("#unrowed")!.nextElementSibling).toBe(section);
  const text = (section.textContent ?? "").replace(/\s+/g, " ");
  expect(text).toMatch(/ChEMBL/);
  expect(text).toMatch(/FDA drug labels/);
  expect(text).toMatch(/hand file/);
  expect(text).toMatch(/any regulator/);
  expect(text).toMatch(/withdrawn/);
  expect(text).toMatch(/not underlined/);
  expect(text).toMatch(/ChEMBL has no disease term for MOGAD; at the last check, no drug on these targets was approved for MOGAD or AE/);
  expect(text).toMatch(/fetched on 9 November 2026/);
  expect(text).toMatch(/by its name in ChEMBL’s disease vocabulary/);
  expect(text).toMatch(/“Approved use” column is a trial phase/);
  expect(text).toMatch(/no success rate/);
  expect(text).toMatch(/combination kits/i);
});

// ---------------------------------------------------------------- stop-risk evaluation (spec 6.4, 7)

const metric = (auc: number, brier: number, n: number, positives: number): RiskMetrics => ({
  auc,
  brier,
  n,
  positives,
  calibration: [
    { p: 0.05, observed: 0.06, n: n / 2 },
    { p: 0.2, observed: 0.25, n: n / 2 },
  ],
});

function riskFile(model: Partial<RiskModelInfo> = {}, metrics: Partial<RiskModelInfo["metrics"]> = {}): RiskFile {
  const f = readFixture<RiskFile>("risk.json");
  return {
    ...f,
    model: {
      ...f.model,
      trained_on: "2026-11-09",
      shipped: "boosted",
      shipped_reason: "boosted AUC 0.682 beats baseline 0.567 by at least 0.02",
      n_train: 41564,
      n_test: 19782,
      ...model,
      metrics: {
        baseline: metric(0.567, 0.142, 19782, 3392),
        boosted: metric(0.682, 0.1347, 19782, 3392),
        boosted_no_sites: metric(0.675, 0.1351, 19782, 3392),
        in_area: metric(0.539, 0.1648, 141, 29),
        ...metrics,
      },
    },
  };
}

const section = async (): Promise<HTMLElement> => {
  const h = await screen.findByRole("heading", { name: "How good is the stop-risk model?" });
  const s = h.closest("section") as HTMLElement;
  expect(s).toHaveAttribute("id", "stop-risk");
  return s;
};

test("stop-risk: the accuracy table renders each model's AUC and Brier from risk.json", async () => {
  stubFetch({ "risk.json": riskFile() });
  renderAt(<Methods />, "/methods#stop-risk");
  const s = await section();
  const table = await within(s).findByRole("table", { name: /accuracy on later trials/i });
  const rows = within(table).getAllByRole("row");
  const text = rows.map((r) => r.textContent?.replace(/\s+/g, " ") ?? "");
  expect(text.find((t) => /Baseline/.test(t))).toMatch(/19,782.*0\.567.*0\.142/);
  expect(text.find((t) => /shipped/.test(t))).toMatch(/0\.682.*0\.135/);
  expect(text.find((t) => /without site/.test(t))).toMatch(/0\.675/);
  // n = 141 is shown, muted, but too few to judge on its own.
  const area = text.find((t) => /this area/i.test(t))!;
  expect(area).toMatch(/141/);
  expect(area).toMatch(/0\.539/);
  expect(area).toMatch(/too few to judge on its own/);
  expect(s.textContent).toMatch(/41,564/);
  expect(s.textContent).toMatch(/boosted AUC 0\.682 beats baseline 0\.567/);
  expect(s.textContent).toMatch(/9 November 2026/);
});

test("stop-risk: in-area row says too few to judge when it is null or under 100", async () => {
  stubFetch({ "risk.json": riskFile({}, { in_area: null }) });
  const { unmount } = renderAt(<Methods />, "/methods#stop-risk");
  let s = await section();
  let row = (await within(s).findByRole("table")).querySelector("tr[data-row='in_area']") as HTMLElement;
  expect(row.textContent).toMatch(/too few to judge/);
  expect(row.textContent).not.toMatch(/0\.\d{3}/);
  unmount();

  stubFetch({ "risk.json": riskFile({}, { in_area: metric(0.9, 0.1, 60, 10) }) });
  renderAt(<Methods />, "/methods#stop-risk");
  s = await section();
  row = (await within(s).findByRole("table")).querySelector("tr[data-row='in_area']") as HTMLElement;
  expect(row.textContent).toMatch(/too few to judge/);
  expect(row.textContent).not.toMatch(/0\.900/);
});

test("stop-risk: the site-leak sentence shows only when flagged", async () => {
  stubFetch({ "risk.json": riskFile({ site_leak_flag: false }) });
  const { unmount } = renderAt(<Methods />, "/methods#stop-risk");
  let s = await section();
  await within(s).findByRole("table");
  expect(s.textContent).not.toMatch(/possible leak/);
  expect(s.textContent).toMatch(/slightly flattering/);
  unmount();

  stubFetch({ "risk.json": riskFile({ site_leak_flag: true }) });
  renderAt(<Methods />, "/methods#stop-risk");
  s = await section();
  await within(s).findByRole("table");
  expect(s.textContent).toMatch(/possible leak/);
});

test("stop-risk: the calibration chart has an accessible description of every point", async () => {
  stubFetch({ "risk.json": riskFile() });
  renderAt(<Methods />, "/methods#stop-risk");
  const s = await section();
  const chart = await within(s).findByRole("img", { name: /calibration/i });
  expect(chart.tagName.toLowerCase()).toBe("svg");
  expect(chart).toHaveAccessibleDescription(/predicted 5%, observed 6%.*predicted 20%, observed 25%/);
  // The diagonal reference line.
  expect(chart.querySelector("[data-ref='diagonal']")).not.toBeNull();
});

test("stop-risk: exclusions lead with enrollment; the comparison, text experiment and reading guide are there", async () => {
  stubFetch({ "risk.json": riskFile({ excluded: ["why_stopped", "enrollment (actual enrollment is small because a trial stopped)"] }) });
  renderAt(<Methods />, "/methods#stop-risk");
  const s = await section();
  await within(s).findByRole("table");
  const items = within(s.querySelector("[data-list='excluded']") as HTMLElement).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent(/enrollment/);
  const text = (s.textContent ?? "").replace(/\s+/g, " ");
  expect(text).toMatch(/Elkin and Zhu/);
  expect(text).toMatch(/Kavalci and Hartshorn/);
  expect(within(s).getByRole("link", { name: /Kavalci and Hartshorn/ })).toHaveAttribute("href", "https://doi.org/10.1038/s41598-023-27416-7");
  expect(within(s).getByRole("link", { name: /Elkin and Zhu/ })).toHaveAttribute("href", "https://doi.org/10.1038/s41598-021-82840-x");
  expect(text).toMatch(/held-out share of their own data \(a 20% hold-out and a 70:30 split\); ours is measured on trials started in later years/);
  expect(text).not.toMatch(/rather than on later years/);
  expect(text).toMatch(/PubMedBERT/);
  expect(text).toMatch(/fewer than 5 earlier finished trials/);
  expect(text).toMatch(/Sponsor's earlier trials: k of n stopped early \(registry\)/);
  expect(text).toMatch(/10th to 90th percentile/);
  expect(text).toMatch(/spread of 20 refits of the model on resampled training data .*placed around the estimate/);
  expect(text).toMatch(/for running trials, the count is as of today/);
  expect(text).toMatch(/Registry files it under/);
  expect(text).toMatch(/actual primary completion date .*or with results posted, is finished in all but name/);
  expect(text).toMatch(/retrained by hand/);
  expect(text).toMatch(/withdrawn/i);
  expect(text).not.toMatch(/risk of failure|likely to fail|in trouble/i);
});

test("stop-risk: area row, calibration cost, short sponsor record and tied estimates are described as they are", async () => {
  stubFetch({ "risk.json": riskFile({}) });
  renderAt(<Methods />, "/methods#stop-risk");
  const s = await section();
  await within(s).findByRole("table");
  const text = (s.textContent ?? "").replace(/\s+/g, " ");
  expect(text).toMatch(/The area row is the evaluation fit \(trained on trials started up to 2015\) scored on this area's test trials only/);
  expect(text).not.toMatch(/same shipped model/);
  expect(text).toMatch(/on the first 9 November 2026 run/);
  expect(text).not.toMatch(/0\.692 to 0\.682/);
  expect(text).toMatch(/the model is told so and does not use the rate/);
  expect(text).not.toMatch(/average stop rate instead/);
  expect(text).toMatch(/Estimates come in steps/);
  expect(text).toMatch(/ties are listed by NCT number/);
});

test("stop-risk: without risk.json the section renders no numbers and says when estimates appear", async () => {
  stubFetch({ "risk.json": 404 });
  renderAt(<Methods />, "/methods#stop-risk");
  const s = await section();
  expect(await within(s).findByText(/appear after the next update/)).toBeInTheDocument();
  expect(within(s).queryByRole("table")).toBeNull();
  expect(within(s).queryByRole("img")).toBeNull();
  expect(s.textContent).not.toMatch(/\d\.\d{2}/);
});

test("stop-risk: retraining names the shipped refit window; start year is not a listed factor", async () => {
  stubFetch({ "risk.json": riskFile({ refit_end: "2019-12-31" }) });
  renderAt(<Methods />, "/methods#stop-risk");
  const s = await section();
  expect(s.textContent).toMatch(/refitted on all finished trials started up to 2019/);
  expect(s.textContent).toMatch(/start year is never listed as a factor/i);
});

// ---------------------------------------------------------------- diligence agent (R8)

const evalReport = {
  citation_validity: 1,
  support_rate: 0.875,
  checker_agreement: 0.9,
  judgement_shown_rate: 0.6,
  cost_usd_mean: 0.043,
  seconds_mean: 52.4,
  n_runs: 8,
  models: { writer: "writer-model-x", planner: "planner-model-y", checker: "checker-model-z" },
  agent_version: "0.1.0",
  generated_at: "2026-11-12T10:00:00Z",
  baseline: { citation_validity: 1, support_rate: 0.875, judgement_shown_rate: 0.6, cost_usd_mean: 0.043, seconds_mean: 52.4 },
};

function stubWithReport(report: unknown | null) {
  const inner = stubFetch();
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).endsWith("diligence/eval-report.json"))
      return report === null ? new Response("", { status: 404 }) : new Response(JSON.stringify(report), { status: 200 });
    return inner(url);
  });
}

const diligence = async (): Promise<HTMLElement> => {
  const h = await screen.findByRole("heading", { name: "How the diligence agent works" });
  const s = h.closest("section") as HTMLElement;
  expect(s).toHaveAttribute("id", "diligence");
  return s;
};

test("diligence: metrics render from eval-report.json", async () => {
  stubWithReport(evalReport);
  renderAt(<Methods />, "/methods#diligence");
  const s = await diligence();
  await within(s).findByText(/8 recorded runs/);
  const text = (s.textContent ?? "").replace(/\s+/g, " ");
  expect(text).toMatch(/Citation validity 100%/);
  expect(text).not.toMatch(/Before the check/); // absent from this report
  expect(text).toMatch(/Support rate 88%/);
  expect(text).toMatch(/supported claims divided by all claims checked, including claims later removed/);
  expect(text).toMatch(/Checker agreement 90%/);
  expect(text).toMatch(/Claude-assisted labels/);
  expect(text).toMatch(/spot-checks a sample/);
  expect(text).toMatch(/Judgement shown in 60%/);
  expect(text).toMatch(/\$0\.043/);
  expect(text).toMatch(/52 seconds/);
  expect(text).toMatch(/writer-model-x/);
  expect(text).toMatch(/planner-model-y/);
  expect(text).toMatch(/checker-model-z/);
  expect(text).toMatch(/version 0\.1\.0/);
  expect(text).toMatch(/12 November 2026/);
  expect(text).not.toMatch(/Evaluation results are published with the first recorded evaluation/);
});

test("diligence: the before-check citation rate renders when the report has it", async () => {
  stubWithReport({ ...evalReport, unretrieved_removal_rate: 0.05 });
  renderAt(<Methods />, "/methods#diligence");
  const s = await diligence();
  await within(s).findByText(/8 recorded runs/);
  expect((s.textContent ?? "").replace(/\s+/g, " ")).toMatch(
    /Before the check, 5% of written sentences cited or named an identifier the run never retrieved/,
  );
});

test("diligence: checker agreement null reads not yet labelled", async () => {
  stubWithReport({ ...evalReport, checker_agreement: null });
  renderAt(<Methods />, "/methods#diligence");
  const s = await diligence();
  await within(s).findByText(/8 recorded runs/);
  expect(s.textContent).toMatch(/Checker agreement not yet labelled/);
  expect(s.textContent).not.toMatch(/Claude-assisted/);
});

test("diligence: no report gives the honest line and no numbers", async () => {
  stubWithReport(null);
  renderAt(<Methods />, "/methods#diligence");
  const s = await diligence();
  expect(await within(s).findByText("Evaluation results are published with the first recorded evaluation.")).toBeInTheDocument();
  expect(s.textContent).not.toMatch(/Citation validity/);
  expect(s.textContent).toMatch(/set at deployment/);
  expect(s.textContent).toMatch(/cost per run is published with the first recorded evaluation/);
  expect(s.textContent).not.toMatch(/cents/);
  expect(s.textContent).toMatch(/other than a single-digit whole number/);
  expect(s.textContent).not.toMatch(/\$\d/);
});

test("diligence: bad JSON is treated as absent", async () => {
  const inner = stubFetch();
  vi.stubGlobal("fetch", async (url: string) =>
    String(url).endsWith("diligence/eval-report.json") ? new Response("<html>", { status: 200 }) : inner(url),
  );
  renderAt(<Methods />, "/methods#diligence");
  const s = await diligence();
  expect(await within(s).findByText("Evaluation results are published with the first recorded evaluation.")).toBeInTheDocument();
});

test("diligence: tools, limits, checks and the two approaches not used", async () => {
  stubWithReport(null);
  renderAt(<Methods />, "/methods#diligence");
  const s = await diligence();
  const text = (s.textContent ?? "").replace(/\s+/g, " ");
  expect(text).toMatch(/Europe PMC covers all PubMed abstracts/);
  expect(text).toMatch(/openFDA/);
  expect(text).toMatch(/12 tool calls/);
  // R38/R39/R40: the limits as config.yaml, loop.py and template.yaml have them.
  expect(text).toMatch(/150,000 input and 8,000 output tokens/);
  expect(text).toMatch(/90 seconds gathering/);
  expect(text).toMatch(/3,000 to 4,096 output tokens/);
  expect(text).toMatch(/at most 2,000 output tokens each/);
  expect(text).toMatch(/after 4 minutes/);
  expect(text).not.toMatch(/60,000|about a minute/);
  // C1/R35, R37, Minor 7.
  expect(text).toMatch(/every identifier named in a sentence was retrieved/);
  expect(text).toMatch(/24% or 24\.4% for 0\.244/);
  expect(text).toMatch(/not checked by the second model/);
  expect(text).toMatch(/recorded runs shipped with the site have none/);
  expect(text).not.toMatch(/Every sentence has a Flag link/);
  expect(text).toMatch(/3 new runs per visitor per day/);
  expect(text).toMatch(/30 per day overall/);
  expect(text).toMatch(/untrusted/);
  expect(text).toMatch(/re-record the evaluation/);
  expect(text).toMatch(/Strands Agents/);
  expect(text).toMatch(/Bedrock Agents/);
});
