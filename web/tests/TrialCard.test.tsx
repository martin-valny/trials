import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { TrialCard } from "../src/components/pipeline/TrialCard";
import type { PipelineFile } from "../src/types";
import { readFixture } from "./helpers";

function file(): PipelineFile {
  const f = structuredClone(readFixture<PipelineFile>("pipeline.json"));
  f.trials["NCT90000001"] = { t: "Study of a thing", why: "Sponsor decision", r: "Business" };
  f.rows[0]!.marks[1]!.via = "other drug";
  f.rows[0]!.marks[1]!.s = "fin";
  return f;
}
const show = (nct: string, variant: "popover" | "sheet" = "popover") =>
  render(
    <MemoryRouter>
      <TrialCard nct={nct} file={file()} rowId="cd20" onClose={vi.fn()} variant={variant} />
    </MemoryRouter>,
  );

test("shows why a trial stopped, and the three actions", () => {
  show("NCT90000001");
  expect(screen.getByText("Study of a thing")).toBeInTheDocument();
  expect(screen.getByText("Stopped")).toBeInTheDocument();
  expect(screen.getByText(/Sponsor decision/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open trial page" })).toHaveAttribute("href", "/trial/NCT90000001");
  expect(screen.getByRole("link", { name: "Show on map" })).toHaveAttribute("href", "/explore?nct=NCT90000001&from=CD20");
  const ct = screen.getByRole("link", { name: /ClinicalTrials\.gov/ });
  expect(ct).toHaveAttribute("href", "https://clinicaltrials.gov/study/NCT90000001");
});

test("a combination trial shows which drug advanced", () => {
  show("NCT90000002", "sheet");
  expect(screen.getByText("Advanced, through other drug")).toBeInTheDocument();
  expect(screen.queryByText(/Sponsor decision/)).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toHaveClass("sheet");
});
