/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isIntroFile } from "../src/data";

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
