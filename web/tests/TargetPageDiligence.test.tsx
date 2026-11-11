import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TargetPage } from "../src/components/target/TargetPage";
import * as lib from "../src/lib/diligence";
import { __resetDiligenceIndex } from "../src/lib/diligenceRelease";
import type { PipelineFile, RunRecord } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

vi.mock("../src/lib/diligence", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/diligence")>();
  return { ...real, diligenceEndpoint: vi.fn(() => "https://agent.test/"), loadRecorded: vi.fn(), loadLatest: vi.fn(async () => null), startRun: vi.fn(), pollRun: vi.fn() };
});
const m = vi.mocked(lib);
const rec = JSON.parse(readFileSync(join(__dirname, "fixtures", "diligence", "cd20__MS.json"), "utf-8")) as RunRecord;

beforeEach(() => {
  __resetDiligenceIndex();
  m.loadRecorded.mockReset().mockImplementation(async (_t, d) => (d === "MS" ? rec : null));
  m.startRun.mockReset().mockResolvedValue({ run_id: "r1" } as never);
  m.pollRun.mockReset();
});

test("a disease change keeps the chips mounted and resets the diligence run", async () => {
  const f = readFixture<PipelineFile>("pipeline.json");
  f.rows[0]!.marks[1]!.dz = ["MG"];
  stubFetch({ "pipeline.json": f });
  let finish!: (r: RunRecord) => void;
  m.pollRun.mockReturnValue(new Promise<RunRecord>((res) => (finish = res)));
  render(
    <MemoryRouter initialEntries={["/target/cd20?disease=MS"]}>
      <Routes>
        <Route path="/target/:slug" element={<TargetPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const panel = () => screen.getByRole("region", { name: "Diligence (AI agent)" });
  await waitFor(() => expect(panel()).toHaveTextContent("Recorded run, 9 Nov 2026"));
  await userEvent.click(screen.getByRole("button", { name: "Run again" }));
  await waitFor(() => expect(panel()).toHaveTextContent("Running"));

  const chip = screen.getByRole("button", { name: /^MG\s*1$/ });
  chip.focus();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: /^MG\s*1$/ })).toBe(chip);
  expect(document.activeElement).toBe(chip);

  await waitFor(() => expect(panel()).not.toHaveTextContent("Recorded run"));
  expect(panel()).not.toHaveTextContent("Running");
  finish(rec); // the old run ends after the switch
  await new Promise((r) => setTimeout(r, 20));
  expect(panel()).not.toHaveTextContent("New run");
  expect(panel()).not.toHaveTextContent("Recorded run");
  expect(screen.getByRole("button", { name: "Run diligence" })).toBeInTheDocument();
});

// The header strip (spec section 5): one line under the lede, sharing panel g's run.
function renderAt(route: string) {
  stubFetch();
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/target/:slug" element={<TargetPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const strip = () => document.querySelector<HTMLElement>(".dstrip:not([data-state='loading'])");
const DESKTOP_INTRO =
  "AI diligence: an agent searches ClinicalTrials.gov, ChEMBL, Europe PMC and openFDA, writes a cited memo, and a second model checks every claim.";

describe("diligence strip", () => {
  const realScroll = Element.prototype.scrollIntoView;
  beforeEach(() => {
    m.diligenceEndpoint.mockReturnValue("https://agent.test/");
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = realScroll;
  });

  test("no run, online: the desktop sentence and Run diligence, which starts the run and scrolls to the diligence panel (a, live)", async () => {
    m.pollRun.mockReturnValue(new Promise<RunRecord>(() => undefined));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderAt("/target/cd20");
    await waitFor(() => expect(strip()).not.toBeNull());
    expect(strip()!.textContent).toContain(DESKTOP_INTRO);
    expect(strip()!.textContent).not.toContain("not investment advice");
    await userEvent.click(within(strip()!).getByRole("button", { name: "Run diligence →" }));
    expect(m.startRun).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalled();
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("pa"));
    expect(document.activeElement).toBe(document.getElementById("pa"));
    await waitFor(() => expect(strip()!.textContent).toMatch(/^AI diligence running · \d+ s/));
    expect(within(strip()!).getByRole("button", { name: "Follow it →" })).toBeInTheDocument();
  });

  test("offline, no run: says so and links to how it works on Methods", async () => {
    m.diligenceEndpoint.mockReturnValue(null);
    renderAt("/target/cd20");
    await waitFor(() => expect(strip()).not.toBeNull());
    expect(strip()!.textContent).toContain("Offline at the moment.");
    expect(within(strip()!).getByRole("link", { name: "How it works →" })).toHaveAttribute("href", "/methods#diligence");
    expect(within(strip()!).queryByRole("button")).toBeNull();
  });

  test("recorded run with a judgement: the read line, the fixed label and Read the memo", async () => {
    renderAt("/target/cd20?disease=MS");
    await waitFor(() => expect(strip()?.dataset.state).toBe("read"));
    expect(strip()!.textContent).toMatch(/^AI read: .+ · (high|medium|low) confidence · \d+ of \d+ claims supported · Recorded /);
    expect(strip()!.textContent).toContain("AI read: mixed · low confidence · 3 of 6 claims supported · Recorded 9 Nov 2026");
    expect(within(strip()!).getByText("AI judgement from public data, not investment advice")).toBeInTheDocument();
    expect(within(strip()!).getByRole("button", { name: "Read the memo →" })).toBeInTheDocument();
  });

  test("a withheld judgement never shows a stance", async () => {
    m.loadRecorded.mockImplementation(async () => ({ ...rec, judgement_shown: false }));
    renderAt("/target/cd20?disease=MS");
    await waitFor(() => expect(strip()?.dataset.state).toBe("read"));
    const t = strip()!.textContent!;
    expect(t).toContain("AI read: judgement withheld · 3 of 6 claims supported · Recorded 9 Nov 2026");
    for (const w of ["favours", "mixed", "argues against"]) expect(t).not.toContain(w);
  });

  test("while looking for a recorded run, a hidden placeholder holds the strip's place", async () => {
    m.loadRecorded.mockReturnValue(new Promise<RunRecord | null>(() => undefined));
    renderAt("/target/cd20?disease=MS");
    await screen.findByRole("heading", { level: 1 });
    const ph = document.querySelector<HTMLElement>(".dstrip[data-state='loading']");
    expect(ph).not.toBeNull();
    expect(ph).toHaveAttribute("aria-hidden", "true");
    expect(ph!.textContent).toBe("");
  });

  test("no strip when the disease has no trials on this target", async () => {
    renderAt("/target/cd20?disease=MOGAD");
    await screen.findByRole("heading", { level: 1 });
    await act(async () => {});
    expect(document.querySelector(".dstrip")).toBeNull();
  });

  test("on a phone the intro is the short sentence", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    renderAt("/target/cd20");
    await waitFor(() => expect(strip()).not.toBeNull());
    expect(strip()!.textContent).toContain("AI diligence: a cited memo from public sources, checked claim by claim.");
    expect(strip()!.textContent).not.toContain("openFDA");
  });

  test("a failed run with nothing shown offers Run again", async () => {
    m.startRun.mockRejectedValue(new Error("down"));
    Element.prototype.scrollIntoView = vi.fn();
    renderAt("/target/cd20");
    await waitFor(() => expect(strip()).not.toBeNull());
    await userEvent.click(within(strip()!).getByRole("button", { name: "Run diligence →" }));
    await waitFor(() => expect(strip()!.textContent).toMatch(/^The last diligence run failed\./));
    expect(within(strip()!).getByRole("button", { name: "Run again →" })).toBeInTheDocument();
  });
});

test("from 1100px the strip reserves one line and its fixed label sits inline after the action", () => {
  const css = readFileSync(join(__dirname, "..", "src", "components", "target", "target.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const wide = /@media \(min-width: 1100px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  expect(/\.dstrip\s*\{([^}]*)\}/.exec(wide)?.[1]).toMatch(/min-height:\s*20px/);
  expect(/\.dstrip-label\s*\{([^}]*)\}/.exec(wide)?.[1]).toMatch(/display:\s*inline/);
  // Below 1100px the reserve for the label's own line stays.
  const base = /(^|\n)\.dstrip\s*\{([^}]*)\}/.exec(css)?.[2] ?? "";
  expect(base).toMatch(/min-height:\s*42px/);
});

// The release gate on the target page (spec section 6.4): closed keeps today's order; recorded or live puts diligence first.
describe("release", () => {
  const INDEX = { runs: [{ target: "cd20", disease: "MS" }] };
  const realScroll = Element.prototype.scrollIntoView;
  beforeEach(() => {
    m.diligenceEndpoint.mockReturnValue(null);
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = realScroll;
  });

  /** The page with the shipped index: absent (404, closed) or the given body. */
  function renderRelease(route: string, index?: unknown) {
    stubFetch(index === undefined ? {} : { "/diligence/index.json": index });
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/target/:slug" element={<TargetPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }
  const contents = () => screen.getByRole("navigation", { name: "Panels on this page" });
  const entries = () =>
    within(contents())
      .getAllByRole("link")
      .map((l) => `${l.querySelector(".cs-l")?.textContent} ${l.querySelector(".cs-n")?.textContent}`);
  const dgPanel = () => screen.getByRole("region", { name: "Diligence (AI agent)" });
  const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const NAMES = ["Timeline", "Companies", "Stops", "Mechanism", "Diseases", "Stop chance"];

  test("closed keeps today's order", async () => {
    renderRelease("/target/cd20");
    await screen.findByRole("heading", { level: 2, name: "Running trials, estimated chance of stopping early" });
    expect(entries()).toEqual([...NAMES.map((x, i) => `${"abcdef"[i]} ${x}`), "g Diligence"]);
    for (const l of "abcdefg") expect(document.getElementById(`p${l}`), l).not.toBeNull();
    expect(document.getElementById("pg")).toBe(within(dgPanel()).getByRole("heading", { level: 2 }));
    const secs = [...document.querySelectorAll(".target-page > .sec")];
    expect(secs[secs.length - 1]).toBe(dgPanel());
    expect(within(contents()).getByRole("link", { name: /Diligence/ })).toHaveTextContent(/offline$/);
  });

  test("open puts diligence first", async () => {
    renderRelease("/target/cd20", INDEX);
    await screen.findByRole("heading", { level: 2, name: "Running trials, estimated chance of stopping early" });
    expect(entries()).toEqual(["a Diligence", ...NAMES.map((x, i) => `${"bcdefg"[i]} ${x}`)]);
    for (const l of "abcdefg") expect(document.getElementById(`p${l}`), l).not.toBeNull();
    expect(document.getElementById("pa")).toBe(within(dgPanel()).getByRole("heading", { level: 2 }));
    expect(dgPanel().querySelector(".ltr")).toHaveTextContent(/^a$/);
    const timeline = screen.getByRole("heading", { level: 2, name: /trial over time/ });
    expect(timeline).toHaveAttribute("id", "pb");
    expect(follows(dgPanel(), timeline)).toBe(true);
  });

  test("open with no trials: the diligence panel is still a, first", async () => {
    renderRelease("/target/cd20?disease=MOGAD", INDEX);
    await screen.findByRole("heading", { level: 2, name: "CD20 by disease" });
    expect(entries()).toEqual(["a Diligence", "f Diseases"]);
    expect(document.getElementById("pa")).toBe(within(dgPanel()).getByRole("heading", { level: 2 }));
    expect(follows(dgPanel(), document.querySelector(".sec.empty-line")!)).toBe(true);
  });

  test("the strip's action goes to the diligence panel: pg when closed, pa when open", async () => {
    for (const [index, id] of [
      [undefined, "pg"],
      [INDEX, "pa"],
    ] as const) {
      __resetDiligenceIndex();
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const { unmount } = renderRelease("/target/cd20?disease=MS", index);
      await waitFor(() => expect(strip()?.dataset.state).toBe("read"));
      await userEvent.click(within(strip()!).getByRole("button", { name: "Read the memo →" }));
      expect(scroll.mock.contexts[0]).toBe(document.getElementById(id));
      unmount();
    }
  });

  test("recorded, no memo for the pair: the strip and panel say so and link to the recorded memos", async () => {
    renderRelease("/target/cd20", INDEX);
    await waitFor(() => expect(strip()?.dataset.state).toBe("unrecorded"));
    expect(strip()!.textContent).toBe("AI diligence: no memo recorded for this target yet · See recorded memos →");
    expect(within(strip()!).getByRole("link", { name: "See recorded memos →" })).toHaveAttribute("href", "/diligence");
    expect(within(dgPanel()).getByText("No recorded memo for this target yet.")).toBeInTheDocument();
    expect(within(dgPanel()).getByRole("link", { name: "See recorded memos →" })).toHaveAttribute("href", "/diligence");
    expect(within(contents()).getByRole("link", { name: /Diligence/ })).toHaveTextContent(/not recorded$/);
    expect(document.body).not.toHaveTextContent("The diligence agent is offline.");
  });

  test("recorded, memo present: the memo renders as today", async () => {
    renderRelease("/target/cd20?disease=MS", INDEX);
    await waitFor(() => expect(dgPanel()).toHaveTextContent("Recorded run, 9 Nov 2026"));
    expect(within(dgPanel()).getAllByText("Three trials of CD20 in MS are listed, one of them stopped.").length).toBeGreaterThan(0);
    expect(within(dgPanel()).getAllByText("AI judgement from public data, not investment advice").length).toBeGreaterThan(0);
    expect(strip()?.dataset.state).toBe("read");
  });

  test("pending shows the skeleton: no panels until the index settles", async () => {
    let settle!: (r: Response) => void;
    const base = stubFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => (String(url).endsWith("diligence/index.json") ? new Promise<Response>((res) => (settle = res)) : base(url))),
    );
    render(
      <MemoryRouter initialEntries={["/target/cd20"]}>
        <Routes>
          <Route path="/target/:slug" element={<TargetPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(base).toHaveBeenCalledWith(expect.stringMatching(/pipeline\.json$/)));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByLabelText("Loading the target page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(document.querySelector(".sec-h")).toBeNull();
    settle(new Response(JSON.stringify(INDEX), { status: 200 }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("CD20");
    expect(entries()[0]).toBe("a Diligence");
  });

  test("?panel=a when open lands on the diligence heading", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderRelease("/target/cd20?disease=MS&panel=a", INDEX);
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("pa"));
    expect(document.getElementById("pa")).toBe(within(dgPanel()).getByRole("heading", { level: 2 }));
  });
});
