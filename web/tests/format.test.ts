import { describe, expect, test } from "vitest";
import {
  fieldLabel,
  formatAgeRange,
  sexLabel,
  firstSentences,
  formatDelta,
  formatValue,
  isStale,
  outcomeLabel,
  phaseLabel,
  phasesLabel,
  reasonLabel,
  statusLabel,
  treatmentLabel,
} from "../src/lib/format";

describe("registry words", () => {
  test("statusLabel", () => {
    expect(statusLabel("RECRUITING")).toBe("Recruiting");
    expect(statusLabel("ACTIVE_NOT_RECRUITING")).toBe("Active, not recruiting");
    expect(statusLabel("NOT_YET_RECRUITING")).toBe("Not yet recruiting");
    expect(statusLabel("ENROLLING_BY_INVITATION")).toBe("Enrolling by invitation");
    expect(statusLabel("COMPLETED")).toBe("Completed");
    expect(statusLabel("TERMINATED")).toBe("Terminated");
    expect(statusLabel("UNKNOWN")).toBe("Unknown");
    expect(statusLabel("SOMETHING_NEW")).toBe("Something new"); // fallback: sentence case
  });
  test("phasesLabel", () => {
    expect(phasesLabel(["PHASE1", "PHASE2"])).toBe("Phase 1/2");
    expect(phasesLabel(["PHASE2", "PHASE3"])).toBe("Phase 2/3");
    expect(phasesLabel(["PHASE3"])).toBe("Phase 3");
    expect(phasesLabel(["EARLY_PHASE1"])).toBe("Early phase 1");
    expect(phasesLabel(["NA"])).toBe("No phase"); // spec §7; phaseLabel("NA") stays "Not applicable" for Explore
    expect(phasesLabel([])).toBe("—");
  });
});

describe("formatValue", () => {
  test("month vs day precision", () => {
    expect(formatValue("start_date", { date: "2027-03-01", precision: "month", type: null })).toBe(
      "Mar 2027",
    );
    expect(
      formatValue("primary_completion_date", { date: "2027-03-15", precision: "day", type: "ESTIMATED" }),
    ).toBe("15 Mar 2027");
  });
  test("lists, null, scalars", () => {
    expect(formatValue("phases", ["PHASE2", "PHASE3"])).toBe("PHASE2, PHASE3");
    expect(formatValue("phases", [])).toBe("—");
    expect(formatValue("why_stopped", null)).toBe("—");
    expect(formatValue("enrollment", 120)).toBe("120");
    expect(formatValue("overall_status", "RECRUITING")).toBe("RECRUITING");
  });
  test("lists of dates", () => {
    expect(formatValue("x", [{ date: "2027-03", precision: "month", type: null }])).toBe("Mar 2027");
  });
});

describe("formatDelta", () => {
  test("signs", () => {
    expect(formatDelta(120)).toBe("slipped 120 days");
    expect(formatDelta(-30)).toBe("pulled in 30 days");
    expect(formatDelta(1)).toBe("slipped 1 day");
    expect(formatDelta(0)).toBe("");
    expect(formatDelta(null)).toBe("");
  });
});

describe("isStale", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  test("boundary is 36 hours", () => {
    expect(isStale("2026-11-03T00:00:00Z", now)).toBe(false); // 36h exactly
    expect(isStale("2026-11-02T23:59:59Z", now)).toBe(true);
    expect(isStale("2026-11-04T07:00:00Z", now)).toBe(false);
  });
  test("unparseable timestamps count as stale", () => {
    expect(isStale("not a date", now)).toBe(true);
  });
});

test("labels", () => {
  expect(fieldLabel("overall_status")).toBe("Overall status");
  expect(fieldLabel("_tracked")).toBe("Registry presence");
  expect(reasonLabel("status_change")).toBe("Status changed");
  expect(reasonLabel(null)).toBe("");
});

describe("outcome changes", () => {
  test("pairs read as measure (time frame)", () => {
    const v = [
      ["Annualized relapse rate", "48 weeks"],
      ["Disability progression", null],
    ];
    expect(formatValue("primary_outcomes", v)).toBe(
      "Annualized relapse rate (48 weeks); Disability progression",
    );
    expect(formatValue("secondary_outcomes", [])).toBe("—");
  });
  test("other list fields keep the plain join", () => {
    expect(formatValue("conditions", ["A", "B"])).toBe("A, B");
  });
});

describe("explorer display text", () => {
  test("phase labels", () => {
    expect(phaseLabel("EARLY_PHASE1")).toBe("Early phase 1");
    expect(phaseLabel("PHASE1")).toBe("Phase 1");
    expect(phaseLabel("PHASE4")).toBe("Phase 4");
    expect(phaseLabel("NA")).toBe("Not applicable");
    expect(phaseLabel(null)).toBe("Not applicable");
  });
  test("outcome labels", () => {
    expect(outcomeLabel("succeeded")).toBe("Advanced to next phase");
    expect(outcomeLabel("stopped")).toBe("Stopped early");
    expect(outcomeLabel("completed_unknown")).toBe("Finished, no follow-on");
    expect(outcomeLabel("running")).toBe("Still running");
    expect(outcomeLabel("unknown")).toBe("Status unknown");
  });
  test("treatment type title case", () => {
    expect(treatmentLabel("BIOLOGICAL")).toBe("Biological");
    expect(treatmentLabel("DIETARY_SUPPLEMENT")).toBe("Dietary supplement");
  });
  test("first two sentences", () => {
    expect(firstSentences("One here. Two there! Three more. Four.")).toBe("One here. Two there!");
    expect(firstSentences("Only one sentence.")).toBe("Only one sentence.");
    expect(firstSentences("Uses e.g. lowercase. Next Sentence. Third.")).toBe("Uses e.g. lowercase. Next Sentence.");
    expect(firstSentences("Ask? Yes. No.")).toBe("Ask? Yes.");
    expect(firstSentences("  Spaced.   Out.  ")).toBe("Spaced. Out.");
  });
});

test.each([
  [0.5, null, "6 months and over"],
  [1 / 12, null, "1 month and over"],
  [18, null, "18 years and over"],
  [null, 17, "up to 17 years"],
  [18, 18, "18 years"],
  [0.5, 17, "6 months–17 years"],
  [18, 55, "18–55 years"],
  [1.5, null, "1.5 years and over"],
  [null, null, ""],
])("formatAgeRange(%s, %s)", (a, b, out) => {
  expect(formatAgeRange(a, b)).toBe(out);
});

test("sexLabel", () => {
  expect(sexLabel("ALL")).toBe("All sexes");
  expect(sexLabel("FEMALE")).toBe("Female only");
  expect(sexLabel("MALE")).toBe("Male only");
});
