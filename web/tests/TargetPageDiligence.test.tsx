import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TargetPage } from "../src/components/target/TargetPage";
import * as lib from "../src/lib/diligence";
import type { PipelineFile, RunRecord } from "../src/types";
import { readFixture, stubFetch } from "./helpers";

vi.mock("../src/lib/diligence", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/diligence")>();
  return { ...real, diligenceEndpoint: vi.fn(() => "https://agent.test/"), loadRecorded: vi.fn(), loadLatest: vi.fn(async () => null), startRun: vi.fn(), pollRun: vi.fn() };
});
const m = vi.mocked(lib);
const rec = JSON.parse(readFileSync(join(__dirname, "fixtures", "diligence", "cd20__MS.json"), "utf-8")) as RunRecord;

beforeEach(() => {
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

  test("no run, online: the desktop sentence and Run diligence, which starts the run and scrolls to g", async () => {
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
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("pg"));
    expect(document.activeElement).toBe(document.getElementById("pg"));
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
