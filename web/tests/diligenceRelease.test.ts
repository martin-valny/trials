import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDiligenceIndex,
  INDEX_TIMEOUT_MS,
  isOpen,
  knownPairs,
  pairHref,
  panelLetters,
  parseIndex,
  useDiligenceRelease,
} from "../src/lib/diligenceRelease";
import type { PipelineFile } from "../src/types";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** A pipeline.json with cd20 (MS trials, NMOSD approvals) and btk (no diseases). */
const PIPELINE = {
  rows: [
    { id: "cd20", marks: [{ dz: ["MS"] }], ap: { NMOSD: [] } },
    { id: "btk", marks: [] },
  ],
  diseases: [],
} as unknown as PipelineFile;

/** Serve the index (a response or a pending promise) and PIPELINE for pipeline.json. */
function serve(index: Response | Promise<Response>) {
  const fn = vi.fn((url: string) => (String(url).endsWith("diligence/index.json") ? index : Promise.resolve(json(200, PIPELINE))));
  vi.stubGlobal("fetch", fn);
  return fn;
}

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

describe("knownPairs", () => {
  it("keeps pairs whose target is a row and whose disease that row has", () => {
    const pairs = [
      { target: "cd20", disease: "MS" },
      { target: "cd20", disease: "NMOSD" },
      { target: "cd20", disease: "all" },
      { target: "btk", disease: "all" },
      { target: "cd20", disease: "MG" },
      { target: "btk", disease: "MS" },
      { target: "gone", disease: "all" },
    ];
    expect(knownPairs(pairs, PIPELINE)).toEqual(pairs.slice(0, 4));
  });
  it("keeps nothing without pipeline.json", () => expect(knownPairs([{ target: "cd20", disease: "all" }], null)).toEqual([]));
});

describe("useDiligenceRelease", () => {
  it("is closed for an empty index", async () => {
    serve(Promise.resolve(json(200, { runs: [] })));
    const { result } = renderHook(() => useDiligenceRelease());
    await waitFor(() => expect(result.current.release).toBe("closed"));
  });
  it("is closed when the index 404s", async () => {
    serve(Promise.resolve(json(404, {})));
    const { result } = renderHook(() => useDiligenceRelease());
    await waitFor(() => expect(result.current.release).toBe("closed"));
  });
  it("is recorded with one pair", async () => {
    serve(Promise.resolve(json(200, { runs: [{ target: "cd20", disease: "MS" }] })));
    const { result } = renderHook(() => useDiligenceRelease());
    await waitFor(() => expect(result.current.release).toBe("recorded"));
    expect(result.current.pairs).toEqual([{ target: "cd20", disease: "MS" }]);
  });
  it("is closed when every recorded target has left the pipeline", async () => {
    serve(Promise.resolve(json(200, { runs: [{ target: "gone", disease: "MS" }, { target: "also-gone", disease: "all" }] })));
    const { result } = renderHook(() => useDiligenceRelease());
    await waitFor(() => expect(result.current.release).toBe("closed"));
    expect(result.current.pairs).toEqual([]);
  });
  it("is recorded with only the known pairs of a mixed index", async () => {
    serve(Promise.resolve(json(200, { runs: [{ target: "gone", disease: "MS" }, { target: "cd20", disease: "MS" }, { target: "cd20", disease: "MG" }] })));
    const { result } = renderHook(() => useDiligenceRelease());
    await waitFor(() => expect(result.current.release).toBe("recorded"));
    expect(result.current.pairs).toEqual([{ target: "cd20", disease: "MS" }]);
  });
  it("is closed when the index is slower than the timeout", async () => {
    vi.useFakeTimers();
    try {
      const fn = serve(new Promise<Response>(() => undefined));
      const { result } = renderHook(() => useDiligenceRelease());
      expect(result.current.release).toBe("pending");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(INDEX_TIMEOUT_MS - 1);
      });
      expect(result.current.release).toBe("pending");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.release).toBe("closed");
      const init = fn.mock.calls[0] as unknown as [string, RequestInit];
      expect(init[1].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("is pending before the fetch settles", async () => {
    let done!: (r: Response) => void;
    serve(new Promise<Response>((r) => (done = r)));
    const { result } = renderHook(() => useDiligenceRelease());
    expect(result.current.release).toBe("pending");
    await act(async () => done(json(200, { runs: [] })));
    await waitFor(() => expect(result.current.release).toBe("closed"));
  });
  it("is live at once when VITE_DILIGENCE_URL is set", async () => {
    vi.stubEnv("VITE_DILIGENCE_URL", "https://x.test/api");
    serve(Promise.resolve(json(200, { runs: [{ target: "cd20", disease: "MS" }, { target: "gone", disease: "MS" }] })));
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
