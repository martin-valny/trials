import { describe, expect, test } from "vitest";
import { fieldLabel, formatDelta, formatValue, isStale, reasonLabel } from "../src/lib/format";

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
