import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DiligenceRunProvider } from "../src/components/target/DiligenceRunContext";
import { FIXED_LABEL, TargetDiligence } from "../src/components/target/TargetDiligence";
import * as lib from "../src/lib/diligence";
import { isOpen, panelLetters, type DiligenceRelease } from "../src/lib/diligenceRelease";
import type { DiligenceStep, PipelineFile, PipelineRow, RunRecord } from "../src/types";
import { readFixture } from "./helpers";

vi.mock("../src/lib/diligence", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/diligence")>();
  return {
    ...real,
    diligenceEndpoint: vi.fn(() => null),
    loadRecorded: vi.fn(async () => null),
    loadLatest: vi.fn(async () => null),
    startRun: vi.fn(),
    pollRun: vi.fn(),
    flagSentence: vi.fn(async () => undefined),
  };
});

const m = vi.mocked(lib);
const fixture = (): RunRecord =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", "diligence", "cd20__MS.json"), "utf-8")) as RunRecord;
const row: PipelineRow = readFixture<PipelineFile>("pipeline.json").rows.find((r) => r.id === "cd20")!;

const online = () => m.diligenceEndpoint.mockReturnValue("https://agent.test/");

function renderPanel(disease: string | null = "MS", release: DiligenceRelease = m.diligenceEndpoint() ? "live" : "closed") {
  return render(
    <MemoryRouter initialEntries={["/target/cd20"]}>
      <DiligenceRunProvider key={disease ?? "all"} row={row} disease={disease}>
        <TargetDiligence
          row={row}
          disease={disease}
          label="CD20"
          diseaseLabel={disease === "MS" ? "Multiple sclerosis" : "All diseases"}
          letter={panelLetters(isOpen(release)).diligence}
          release={release}
        />
      </DiligenceRunProvider>
    </MemoryRouter>,
  );
}
const panel = () => screen.getByRole("region", { name: "Diligence (AI agent)" });

beforeEach(() => {
  m.diligenceEndpoint.mockReturnValue(null);
  m.loadRecorded.mockResolvedValue(null);
  m.loadLatest.mockReset().mockResolvedValue(null);
  m.startRun.mockReset();
  m.pollRun.mockReset();
  m.flagSentence.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

test("panel g heading and the fixed label", async () => {
  m.loadRecorded.mockResolvedValue(fixture());
  renderPanel();
  expect(await screen.findByText(/^Recorded run, 9 Nov 2026$/)).toBeInTheDocument();
  expect(within(panel()).getByRole("heading", { level: 2, name: "Diligence (AI agent)" })).toBeInTheDocument();
  expect(within(panel()).getByText(FIXED_LABEL)).toBeInTheDocument();
  expect(FIXED_LABEL).toBe("AI judgement from public data, not investment advice");
});

test("offline falls back to recorded run", async () => {
  m.loadRecorded.mockResolvedValue(fixture());
  renderPanel();
  expect(await screen.findByText("Recorded run, 9 Nov 2026")).toBeInTheDocument();
  expect(m.loadRecorded).toHaveBeenCalledWith("cd20", "MS");
  // Offline: no run button and no Flag (the run is not on a backend).
  expect(screen.queryByRole("button", { name: /Run (diligence|again)/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Flag/ })).toBeNull();
  expect(screen.getAllByText("Three trials of CD20 in MS are listed, one of them stopped.").length).toBeGreaterThan(0);
});

test("offline with no recorded run says so and links to a recorded example", async () => {
  m.loadRecorded.mockImplementation(async (t, d) => (t === "cd20" && d === "MS" ? fixture() : null));
  renderPanel(null);
  expect(await screen.findByText(/The diligence agent is offline/)).toBeInTheDocument();
  const link = await screen.findByRole("link", { name: /recorded example/i });
  expect(link).toHaveAttribute("href", "/target/cd20?disease=MS&panel=g");
  expect(m.loadRecorded).toHaveBeenCalledWith("cd20", "MS");
  expect(screen.queryByRole("button", { name: /Run/ })).toBeNull();
});

test("no recorded example link while the example has no recording (R47)", async () => {
  renderPanel(null);
  expect(await screen.findByText(/The diligence agent is offline/)).toBeInTheDocument();
  await act(async () => {});
  expect(m.loadRecorded).toHaveBeenCalledWith("cd20", "MS");
  expect(screen.queryByRole("link", { name: /recorded example/i })).toBeNull();
  expect(screen.getByText(/No run has been recorded for this target yet/)).toBeInTheDocument();
});

test("recorded, no memo for this pair: one line and a link to the recorded memos, never 'offline'", async () => {
  renderPanel(null, "recorded");
  expect(await screen.findByText("No recorded memo for this target yet.")).toBeInTheDocument();
  expect(within(panel()).getByRole("link", { name: "See recorded memos →" })).toHaveAttribute("href", "/diligence");
  expect(panel()).not.toHaveTextContent("The diligence agent is offline.");
  expect(within(panel()).queryByRole("link", { name: /recorded example/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /Run/ })).toBeNull();
});

test("the heading's id and letter follow the panel's letter: a once open, g while closed", async () => {
  m.loadRecorded.mockResolvedValue(fixture());
  const { unmount } = renderPanel("MS", "recorded");
  await screen.findByText("Recorded run, 9 Nov 2026");
  expect(within(panel()).getByRole("heading", { level: 2, name: "Diligence (AI agent)" })).toHaveAttribute("id", "pa");
  expect(panel()).toHaveAttribute("aria-labelledby", "pa");
  expect(panel().querySelector(".ltr")).toHaveTextContent(/^a$/);
  unmount();
  renderPanel("MS", "closed");
  await screen.findByText("Recorded run, 9 Nov 2026");
  expect(within(panel()).getByRole("heading", { level: 2, name: "Diligence (AI agent)" })).toHaveAttribute("id", "pg");
  expect(panel().querySelector(".ltr")).toHaveTextContent(/^g$/);
});

test("online: the backend's run is asked for first and shown over the committed one (R45)", async () => {
  online();
  const committed = fixture();
  const newer = { ...fixture(), run_id: "newer", finished_at: "2026-11-12T08:00:00Z" };
  m.loadRecorded.mockResolvedValue(committed);
  m.loadLatest.mockResolvedValue({ replay: newer, stale: true });
  renderPanel();
  expect(await screen.findByText("Recorded run, 12 Nov 2026 · data has changed since")).toBeInTheDocument();
  expect(m.loadLatest).toHaveBeenCalledWith("cd20", "MS");
  expect(m.startRun).not.toHaveBeenCalled();
  // A backend run can be flagged; Run again forces a new run.
  expect(screen.getAllByRole("button", { name: /^Flag/ }).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
});

test("online: falls back to the committed run when the backend has none", async () => {
  online();
  m.loadRecorded.mockResolvedValue(fixture());
  renderPanel();
  expect(await screen.findByText("Recorded run, 9 Nov 2026")).toBeInTheDocument();
  expect(m.loadLatest).toHaveBeenCalledWith("cd20", "MS");
  expect(screen.queryByRole("button", { name: /^Flag/ })).toBeNull();
});

test("offline never asks the backend", async () => {
  m.loadRecorded.mockResolvedValue(fixture());
  renderPanel();
  await screen.findByText("Recorded run, 9 Nov 2026");
  expect(m.loadLatest).not.toHaveBeenCalled();
});

test("online idle shows Run diligence; the first click is not forced", async () => {
  online();
  m.startRun.mockResolvedValue({ replay: fixture(), stale: false });
  renderPanel();
  const run = await screen.findByRole("button", { name: "Run diligence" });
  await userEvent.click(run);
  expect(m.startRun).toHaveBeenCalledWith("cd20", "MS", false);
  expect(await screen.findByText("Recorded run, 9 Nov 2026")).toBeInTheDocument();
  // A run from the backend can be flagged.
  // Kept sentences s1, s2, s3 and s5 (s4 was removed by the checker).
  expect(screen.getAllByRole("button", { name: /^Flag/ }).length).toBe(4);
});

test("disease null means all", async () => {
  online();
  renderPanel(null);
  await screen.findByRole("button", { name: "Run diligence" });
  expect(m.loadRecorded).toHaveBeenCalledWith("cd20", "all");
});

test("button hidden when the disease is not valid for the row", async () => {
  online();
  renderPanel("MG");
  expect(await screen.findByText("No trials on this target in MG")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Run/ })).toBeNull();
});

test("running: a vertical step list with kind, tool, text and elapsed, then the memo", async () => {
  online();
  const rec = fixture();
  let release: (r: RunRecord) => void = () => {};
  let push: (s: DiligenceStep) => void = () => {};
  m.startRun.mockResolvedValue({ run_id: "r1" });
  m.pollRun.mockImplementation((_id, onStep) => {
    push = onStep;
    return new Promise<RunRecord>((res) => (release = res));
  });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
  expect(m.pollRun).toHaveBeenCalledWith("r1", expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  act(() => {
    push(rec.steps[0]!);
    push({ ...rec.steps[1]!, ms: 1240 });
  });
  const trace = screen.getByRole("list", { name: "Agent trace" });
  const items = within(trace).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("plan");
  expect(items[0]).toHaveTextContent("Planning: CD20 · MS");
  expect(items[1]).toHaveTextContent("tool");
  expect(items[1]).toHaveTextContent("site_target");
  expect(items[1]).toHaveTextContent("3 trials on this target (1 stopped)");
  expect(items[1]).toHaveTextContent("1.2 s");
  // A polite live region announces only the newest step's text.
  const live = screen.getByTestId("dg-live");
  expect(live).toHaveAttribute("aria-live", "polite");
  expect(live).toHaveTextContent(/^Step 2: 3 trials on this target \(1 stopped\)$/);
  // No Run button while running.
  expect(screen.queryByRole("button", { name: /Run/ })).toBeNull();
  await act(async () => release(rec));
  expect(await screen.findByRole("heading", { name: "Landscape" })).toBeInTheDocument();
});

test("done: citation chips link to their sources", async () => {
  online();
  const rec = fixture();
  rec.memo!.sections.push(
    { id: "s5", section: "literature", text: "A paper says so.", cites: ["PMID:123", "PPR456"] },
    { id: "s6", section: "competition", text: "A drug is approved.", cites: ["CHEMBL1201", "FDA:abc-123"] },
  );
  rec.verdicts.push(
    { sentence_id: "s5", verdict: "supported", reason: "ok" },
    { sentence_id: "s6", verdict: "supported", reason: "ok" },
  );
  m.loadRecorded.mockResolvedValue(rec);
  renderPanel();
  await screen.findByText("Recorded run, 9 Nov 2026");
  const href = (id: string) => screen.getAllByRole("link", { name: new RegExp(`^${id}\\b`) })[0]!.getAttribute("href");
  expect(href("NCT90000001")).toBe("https://clinicaltrials.gov/study/NCT90000001");
  expect(href("PMID:123")).toBe("https://pubmed.ncbi.nlm.nih.gov/123/");
  expect(href("PPR456")).toBe("https://europepmc.org/article/PPR/PPR456");
  expect(href("CHEMBL1201")).toBe("https://www.ebi.ac.uk/chembl/compound_report_card/CHEMBL1201/");
  expect(href("FDA:abc-123")).toBe("https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=abc-123");
  for (const h of ["Landscape", "Track record elsewhere", "Literature", "Competitive position", "Read", "What would change this view"])
    expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
  expect(screen.getByText(/Written by an AI model/)).toBeInTheDocument();
});

test("done: partly mark in text, removed list as plain text, judgement with reasons and metadata", async () => {
  m.loadRecorded.mockResolvedValue(fixture());
  renderPanel();
  await screen.findByText("Recorded run, 9 Nov 2026");
  expect(
    screen.getByText("partly supported — The source says sponsor decision after interim safety review, not a cause."),
  ).toBeInTheDocument();
  const removed = screen.getByRole("region", { name: "Removed by the checker" });
  expect(removed).toHaveTextContent("A competing programme reported a positive phase 3 result.");
  expect(removed).toHaveTextContent("Nothing in the source says this.");
  expect(within(removed).queryAllByRole("link")).toHaveLength(0);
  const j = screen.getByRole("region", { name: "Judgement" });
  expect(j).toHaveTextContent("Mixed on further investment in this mechanism for this disease");
  expect(j).toHaveTextContent("Confidence: low");
  expect(within(j).queryAllByRole("link")).toHaveLength(0); // no bare #fragments under HashRouter
  const reasons = within(j).getAllByRole("button");
  expect(reasons.map((a) => a.textContent)).toEqual([
    "Three trials of CD20 in MS are listed, one of them stopped.",
    "The two running trials carry a stop risk near a quarter.",
  ]);
  await userEvent.click(reasons[0]!);
  expect(document.activeElement).toHaveTextContent("Three trials of CD20 in MS are listed, one of them stopped.");
  expect(within(j).getByText(FIXED_LABEL)).toBeInTheDocument();
  expect(screen.getByText("A phase 3 readout in the running trials.")).toBeInTheDocument();
  expect(screen.getByText("Whether the stopped trial signals a class issue is open.")).toBeInTheDocument();
  const meta = screen.getByRole("group", { name: "Run details" });
  expect(meta).toHaveTextContent("REPLACE_WITH_WRITER_MODEL_ID");
  expect(meta).toHaveTextContent("6,600 in · 720 out");
  expect(meta).toHaveTextContent("$0.00");
  expect(meta).toHaveTextContent("4 Nov 2026");
  expect(meta).toHaveTextContent("0.1.0");
  // The synthetic run took 0 ms: no duration is claimed, and no step shows a time.
  expect(meta).not.toHaveTextContent("Duration");
  expect(meta).not.toHaveTextContent("0.0 s");
  for (const li of within(screen.getByRole("list", { name: "Agent trace" })).getAllByRole("listitem")) expect(li).not.toHaveTextContent(/\d s$/);
});

test("withheld judgement lists the claims behind it", async () => {
  const rec = fixture();
  rec.judgement_shown = false;
  rec.memo!.judgement.reasons = ["s1", "s2"];
  m.loadRecorded.mockResolvedValue(rec);
  renderPanel();
  await screen.findByText("Recorded run, 9 Nov 2026");
  const j = screen.getByRole("region", { name: "Judgement" });
  expect(j).toHaveTextContent("Judgement withheld: claims behind it could not be verified");
  expect(j).not.toHaveTextContent("Mixed on");
  expect(j).toHaveTextContent("The stopped trial ended after an interim safety review.");
  expect(j).toHaveTextContent("partly supported");
  expect(within(j).getByText(FIXED_LABEL)).toBeInTheDocument();
});

test("data-changed replay adds the stale words and Run again forces a new run", async () => {
  online();
  m.startRun.mockResolvedValueOnce({ replay: fixture(), stale: true });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
  expect(await screen.findByText("Recorded run, 9 Nov 2026 · data has changed since")).toBeInTheDocument();
  m.startRun.mockResolvedValueOnce({ replay: fixture(), stale: false });
  await userEvent.click(screen.getByRole("button", { name: "Run again" }));
  expect(m.startRun).toHaveBeenLastCalledWith("cd20", "MS", true);
});

test("online with a committed run shows it with Run again", async () => {
  online();
  m.loadRecorded.mockResolvedValue(fixture());
  renderPanel();
  expect(await screen.findByText("Recorded run, 9 Nov 2026")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
  // A committed run is not on the backend: no Flag.
  expect(screen.queryByRole("button", { name: /^Flag/ })).toBeNull();
});

test("capped shows the latest recorded run", async () => {
  online();
  const latest = fixture();
  latest.finished_at = "2026-11-08T09:00:00Z";
  m.startRun.mockResolvedValue({ capped: latest });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
  expect(await screen.findByText("Daily limit reached — showing the latest recorded run")).toBeInTheDocument();
  expect(screen.getByText("Recorded run, 8 Nov 2026")).toBeInTheDocument();
});

test("capped with nothing recorded falls back to the committed run", async () => {
  online();
  m.loadRecorded.mockResolvedValue(fixture());
  m.startRun.mockResolvedValue({ capped: null });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run again" }));
  expect(await screen.findByText("Daily limit reached — showing the latest recorded run")).toBeInTheDocument();
  expect(screen.getByText("Recorded run, 9 Nov 2026")).toBeInTheDocument();
});

test("capped with nothing recorded anywhere says so and stops offering runs", async () => {
  online();
  m.startRun.mockResolvedValue({ capped: null });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
  expect(await screen.findByText("Daily limit reached — no recorded run is available yet. Try again tomorrow.")).toBeInTheDocument();
  expect(screen.queryByText(/showing the latest recorded run/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Run/ })).toBeNull();
  expect(screen.queryByText(/The agent plans its searches/)).toBeNull();
});

test("unmounting during a run aborts the polling", async () => {
  online();
  m.startRun.mockResolvedValue({ run_id: "r1" });
  let signal: AbortSignal | undefined;
  m.pollRun.mockImplementation((_id, _onStep, opts) => {
    signal = opts?.signal;
    return new Promise<RunRecord>(() => {});
  });
  const { unmount } = renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
  expect(signal).toBeDefined();
  expect(signal!.aborted).toBe(false);
  unmount();
  expect(signal!.aborted).toBe(true);
});

test("poll timeout message", async () => {
  online();
  m.startRun.mockResolvedValue({ run_id: "r1" });
  m.pollRun.mockImplementation(async (_id, onStep) => {
    onStep(fixture().steps[0]!);
    throw new Error("timeout");
  });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
  expect(await screen.findByText(/The run did not finish/)).toBeInTheDocument();
  // The partial trace stays; nothing spins; the visitor can try again.
  expect(within(screen.getByRole("list", { name: "Agent trace" })).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Run diligence" })).toBeInTheDocument();
});

test("an unreachable agent falls back to the recorded run", async () => {
  online();
  m.loadRecorded.mockResolvedValue(fixture());
  m.startRun.mockRejectedValue(new TypeError("Failed to fetch"));
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run again" }));
  expect(await screen.findByText(/The diligence agent could not be reached/)).toBeInTheDocument();
  expect(screen.getByText("Recorded run, 9 Nov 2026")).toBeInTheDocument();
});

test("a run the backend lost says so", async () => {
  online();
  m.startRun.mockResolvedValue({ run_id: "r1" });
  m.pollRun.mockRejectedValue(new Error("not_found"));
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
  expect(await screen.findByText(/The run could not be found/)).toBeInTheDocument();
});

test("keyboard reaches Run, and Flag opens a form that sends", async () => {
  online();
  m.startRun.mockResolvedValue({ replay: fixture(), stale: false });
  renderPanel();
  await screen.findByRole("button", { name: "Run diligence" });
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Run diligence" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await screen.findByText("Recorded run, 9 Nov 2026");
  const flags = screen.getAllByRole("button", { name: /^Flag/ });
  // Tab until the first Flag has focus.
  for (let i = 0; i < 40 && document.activeElement !== flags[0]; i++) await userEvent.tab();
  expect(flags[0]).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  const box = screen.getByRole("textbox", { name: /What is wrong with this claim/ });
  expect(box).toHaveFocus();
  expect(box).toHaveAttribute("maxLength", "500");
  await userEvent.type(box, "Wrong count");
  await userEvent.click(screen.getByRole("button", { name: "Send flag" }));
  expect(m.flagSentence).toHaveBeenCalledWith(fixture().run_id, "s1", "Wrong count");
  expect(await screen.findByText("Thanks — flagged for review")).toBeInTheDocument();
});

test("Flag form cancels with Escape and returns focus", async () => {
  online();
  m.startRun.mockResolvedValue({ replay: fixture(), stale: false });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
  const flag = (await screen.findAllByRole("button", { name: /^Flag/ }))[1]!;
  await userEvent.click(flag);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getAllByRole("button", { name: /^Flag/ })[1]).toHaveFocus();
});

test("banned phrases: no buy / sell / recommend investing; 'investment advice' only in the fixed label", async () => {
  online();
  const withheld = fixture();
  withheld.judgement_shown = false;
  for (const [rec, stale] of [
    [fixture(), false],
    [withheld, true],
  ] as const) {
    m.startRun.mockResolvedValue({ replay: rec, stale });
    const { unmount } = renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Run diligence" }));
    await screen.findByText(/^Recorded run/);
    const text = panel().textContent ?? "";
    expect(text).not.toMatch(/\bbuy\b|\bsell\b|recommend investing/i);
    expect(text.split("investment advice").length - 1).toBe(1);
    expect(text).toContain(FIXED_LABEL);
    unmount();
  }
  for (const stance of ["favours", "against"] as const) {
    const rec = fixture();
    rec.memo!.judgement.stance = stance;
    m.loadRecorded.mockResolvedValue(rec);
    const { unmount } = renderPanel();
    await screen.findByText(/^Recorded run/);
    const text = panel().textContent ?? "";
    expect(text).toMatch(stance === "favours" ? /Favours further investment/ : /Argues against further investment/);
    expect(text).not.toMatch(/\bbuy\b|\bsell\b|recommend investing/i);
    expect(text.split("investment advice").length - 1).toBe(1);
    unmount();
  }
});
