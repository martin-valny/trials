import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
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
