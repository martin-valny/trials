import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDiligenceIndex, isOpen, pairHref, panelLetters, parseIndex, useDiligenceRelease } from "../src/lib/diligenceRelease";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  __resetDiligenceIndex();
  vi.stubEnv("VITE_DILIGENCE_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseIndex", () => {
  it("rejects malformed", () => {
    for (const bad of [null, {}, { runs: "x" }, { runs: [{ target: "cd20" }] }, { runs: [{ target: "", disease: "MS" }] }]) {
      expect(parseIndex(bad)).toBeNull();
    }
  });
  it("dedupes", () => {
    const p = { target: "cd20", disease: "MS" };
    expect(parseIndex({ runs: [p, { ...p }] })).toEqual([p]);
  });
});

describe("useDiligenceRelease", () => {
  it("is closed for an empty index", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { runs: [] })));
    const { result } = renderHook(() => useDiligenceRelease());
    await waitFor(() => expect(result.current.release).toBe("closed"));
  });
  it("is closed when the index 404s", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, {})));
    const { result } = renderHook(() => useDiligenceRelease());
    await waitFor(() => expect(result.current.release).toBe("closed"));
  });
  it("is recorded with one pair", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { runs: [{ target: "cd20", disease: "MS" }] })));
    const { result } = renderHook(() => useDiligenceRelease());
    await waitFor(() => expect(result.current.release).toBe("recorded"));
    expect(result.current.pairs).toEqual([{ target: "cd20", disease: "MS" }]);
  });
  it("is pending before the fetch settles", async () => {
    let done!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((r) => (done = r))));
    const { result } = renderHook(() => useDiligenceRelease());
    expect(result.current.release).toBe("pending");
    await act(async () => done(json(200, { runs: [] })));
    await waitFor(() => expect(result.current.release).toBe("closed"));
  });
  it("is live at once when VITE_DILIGENCE_URL is set", async () => {
    vi.stubEnv("VITE_DILIGENCE_URL", "https://x.test/api");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { runs: [{ target: "cd20", disease: "MS" }] })));
    const { result } = renderHook(() => useDiligenceRelease());
    expect(result.current.release).toBe("live");
    await waitFor(() => expect(result.current.pairs).toHaveLength(1));
    expect(result.current.release).toBe("live");
  });
});

describe("isOpen", () => {
  it("is true for recorded and live only", () => {
    expect(["pending", "closed", "recorded", "live"].map((r) => isOpen(r as never))).toEqual([false, false, true, true]);
  });
});

describe("panelLetters", () => {
  it("closed: the diligence panel is last", () => {
    expect(panelLetters(false)).toEqual({ timeline: "a", companies: "b", stops: "c", mechanism: "d", diseases: "e", risk: "f", diligence: "g" });
  });
  it("open: the diligence panel leads", () => {
    const o = panelLetters(true);
    expect(o).toEqual({ diligence: "a", timeline: "b", companies: "c", stops: "d", mechanism: "e", diseases: "f", risk: "g" });
    expect(new Set(Object.values(o)).size).toBe(7);
  });
});

describe("pairHref", () => {
  it("omits the disease for all", () => expect(pairHref({ target: "cd20", disease: "all" }, true)).toBe("/target/cd20?panel=a"));
  it("carries the disease and the closed letter", () =>
    expect(pairHref({ target: "cd20", disease: "MS" }, false)).toBe("/target/cd20?disease=MS&panel=g"));
});
