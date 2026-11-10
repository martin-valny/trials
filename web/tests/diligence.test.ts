import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  diligenceEndpoint,
  claimCounts,
  diligenceKey,
  flagSentence,
  isValidDisease,
  loadLatest,
  loadRecorded,
  POLL_TIMEOUT_MS,
  pollRun,
  renderable,
  startRun,
  stripView,
} from "../src/lib/diligence";
import type { PipelineRow, RunRecord } from "../src/types";

const record = JSON.parse(readFileSync(join(__dirname, "fixtures", "diligence", "cd20__MS.json"), "utf-8")) as RunRecord;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("diligenceKey / endpoint", () => {
  it("joins target and disease", () => expect(diligenceKey("cd20", "all")).toBe("cd20__all"));
  it("is offline when the env is absent or empty", () => {
    vi.stubEnv("VITE_DILIGENCE_URL", "");
    expect(diligenceEndpoint()).toBeNull();
  });
  it("is offline when the env is undefined", () => {
    vi.stubEnv("VITE_DILIGENCE_URL", undefined as unknown as string);
    expect(diligenceEndpoint()).toBeNull();
  });
  it("normalises the trailing slash", () => {
    vi.stubEnv("VITE_DILIGENCE_URL", "https://x.test/api");
    expect(diligenceEndpoint()).toBe("https://x.test/api/");
    vi.stubEnv("VITE_DILIGENCE_URL", "https://x.test/api/");
    expect(diligenceEndpoint()).toBe("https://x.test/api/");
  });
});

describe("loadRecorded", () => {
  it("fetches diligence/<key>.json under the base", async () => {
    const f = vi.fn(async () => json(200, record));
    vi.stubGlobal("fetch", f);
    expect(await loadRecorded("cd20", "MS")).toEqual(record);
    expect(f).toHaveBeenCalledWith(import.meta.env.BASE_URL + "diligence/cd20__MS.json");
  });
  it("is null on 404, bad JSON, or network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect(await loadRecorded("cd20", "MS")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect(await loadRecorded("cd20", "MS")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
    expect(await loadRecorded("cd20", "MS")).toBeNull();
  });
});

describe("loadLatest (GET /runs/latest, R45)", () => {
  beforeEach(() => vi.stubEnv("VITE_DILIGENCE_URL", "https://x.test/api"));
  it("asks the read-only lookup with the pair in the query and maps 200", async () => {
    const f = vi.fn(async () => json(200, { replay: record, stale: true }));
    vi.stubGlobal("fetch", f);
    expect(await loadLatest("cd20", "all")).toEqual({ replay: record, stale: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/api/runs/latest?target=cd20&disease=all");
    expect(init.method ?? "GET").toBe("GET");
  });
  it("is null on 404, 5xx, network errors, and offline (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { error: "none" })));
    expect(await loadLatest("cd20", "MS")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => json(503, {})));
    expect(await loadLatest("cd20", "MS")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
    expect(await loadLatest("cd20", "MS")).toBeNull();
    vi.stubEnv("VITE_DILIGENCE_URL", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await loadLatest("cd20", "MS")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("gives up after 5 s so the panel falls back to the committed run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))),
    );
    const p = loadLatest("cd20", "MS");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeNull();
  });
});

describe("startRun", () => {
  beforeEach(() => vi.stubEnv("VITE_DILIGENCE_URL", "https://x.test/api"));
  const call = (res: Response) => {
    const f = vi.fn(async () => res);
    vi.stubGlobal("fetch", f);
    return f;
  };
  it("posts the body and maps 202", async () => {
    const f = call(json(202, { run_id: "r1" }));
    expect(await startRun("cd20", "MS", true)).toEqual({ run_id: "r1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/api/runs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ target: "cd20", disease: "MS", force: true });
  });
  it("maps 200 to a replay with stale", async () => {
    call(json(200, { replay: record, stale: true }));
    expect(await startRun("cd20", "MS", false)).toEqual({ replay: record, stale: true });
  });
  it("maps 429 to capped, with or without a latest run", async () => {
    call(json(429, { latest: record, reason: "daily limit reached" }));
    expect(await startRun("cd20", "MS", false)).toEqual({ capped: record });
    call(json(429, { latest: null, reason: "daily limit reached" }));
    expect(await startRun("cd20", "MS", false)).toEqual({ capped: null });
  });
  it("throws on 400, 5xx and network errors", async () => {
    call(json(400, { error: "unknown target" }));
    await expect(startRun("x", "all", false)).rejects.toThrow();
    call(json(500, { error: "boom" }));
    await expect(startRun("x", "all", false)).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
    await expect(startRun("x", "all", false)).rejects.toThrow();
  });
  it("throws when offline", async () => {
    vi.stubEnv("VITE_DILIGENCE_URL", "");
    await expect(startRun("x", "all", false)).rejects.toThrow();
  });
});

describe("flagSentence", () => {
  beforeEach(() => vi.stubEnv("VITE_DILIGENCE_URL", "https://x.test/api/"));
  it("posts to flags and resolves on 204", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    await flagSentence("r1", "s1", "wrong");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/api/flags");
    expect(JSON.parse(init.body as string)).toEqual({ run_id: "r1", sentence_id: "s1", reason: "wrong" });
  });
  it("throws on 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(429, {})));
    await expect(flagSentence("r1", "s1", "x")).rejects.toThrow();
  });
});

describe("pollRun", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_DILIGENCE_URL", "https://x.test/api");
    vi.useFakeTimers();
  });
  const step = (n: number) => ({ ...record.steps[0], n });
  const running = (n: number): RunRecord => ({ ...record, status: "running", steps: Array.from({ length: n }, (_, i) => step(i + 1)) });

  it("reports each new step once and resolves on done", async () => {
    const queue = [json(200, running(1)), json(200, running(2)), json(200, { ...record, status: "done" })];
    const f = vi.fn(async () => queue.shift() as Response);
    vi.stubGlobal("fetch", f);
    const seen: number[] = [];
    const p = pollRun("r1", (s) => seen.push(s.n));
    await vi.advanceTimersByTimeAsync(5000);
    const done = await p;
    expect(done.status).toBe("done");
    expect(seen).toEqual(Array.from({ length: record.steps.length }, (_, i) => i + 1));
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://x.test/api/runs/r1");
  });
  it("resolves on failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ...record, status: "failed" })));
    const p = pollRun("r1", () => {});
    await vi.advanceTimersByTimeAsync(10);
    expect((await p).status).toBe("failed");
  });
  it("treats network errors, 429 and 5xx as transient", async () => {
    const queue: Array<() => Promise<Response>> = [
      () => Promise.reject(new TypeError("down")),
      async () => json(429, {}),
      async () => json(503, {}),
      async () => json(200, { ...record, status: "done" }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => (queue.shift() as () => Promise<Response>)()));
    const p = pollRun("r1", () => {});
    await vi.advanceTimersByTimeAsync(10000);
    expect((await p).status).toBe("done");
  });
  it("rejects immediately with not_found on 404", async () => {
    const f = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", f);
    await expect(pollRun("r1", () => {})).rejects.toThrow("not_found");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("stops polling when its signal aborts between polls", async () => {
    const f = vi.fn(async () => json(200, running(1)));
    vi.stubGlobal("fetch", f);
    const c = new AbortController();
    const p = pollRun("r1", () => {}, { signal: c.signal });
    const assertion = expect(p).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(1500);
    const calls = f.mock.calls.length;
    c.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.mock.calls.length).toBe(calls);
  });
  it("aborts an in-flight poll request", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
      }),
    );
    const c = new AbortController();
    const p = pollRun("r1", () => {}, { signal: c.signal });
    const assertion = expect(p).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(10);
    c.abort();
    await assertion;
    expect(seen?.aborted).toBe(true);
  });
  it("a stalled fetch cannot outlive timeoutMs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init?: RequestInit) =>
          new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
      ),
    );
    const p = pollRun("r1", () => {}, { intervalMs: 1000, timeoutMs: 4000 });
    const assertion = expect(p).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
  it("follows a run for 240 s by default, the Lambda Timeout (R40)", () => {
    expect(POLL_TIMEOUT_MS).toBe(240000);
  });
  it("rejects with timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, running(0))));
    const p = pollRun("r1", () => {}, { intervalMs: 1000, timeoutMs: 5000 });
    const assertion = expect(p).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
  });
});

describe("renderable", () => {
  it("groups sentences by section in order and builds the verdict map", () => {
    const r = renderable(record);
    expect(Object.keys(r.sections)).toEqual(["landscape", "track_record", "literature", "competition"]);
    const total = Object.values(r.sections).reduce((n, s) => n + s.length, 0);
    expect(total).toBe(record.memo!.sections.length);
    expect(r.verdictBySentence.size).toBe(record.verdicts.length);
    expect(r.removed).toEqual(record.removed);
  });
  it("trusts the backend gate", () => {
    expect(renderable({ ...record, judgement_shown: true }).judgementShown).toBe(true);
    expect(renderable({ ...record, judgement_shown: false }).judgementShown).toBe(false);
  });
  it("never shows a judgement without a memo", () => {
    const r = renderable({ ...record, memo: null, judgement_shown: true });
    expect(r.judgementShown).toBe(false);
    expect(Object.values(r.sections).every((s) => s.length === 0)).toBe(true);
  });
});

describe("isValidDisease", () => {
  const row = { marks: [{ dz: ["MS"] }, { dz: ["SLE", "RA"] }] } as unknown as PipelineRow;
  it("accepts all and diseases on a mark", () => {
    expect(isValidDisease(row, "all")).toBe(true);
    expect(isValidDisease(row, "SLE")).toBe(true);
  });
  it("rejects others", () => expect(isValidDisease(row, "NMO")).toBe(false));
});

describe("claimCounts", () => {
  it("counts supported verdicts and all judged sentences", () => {
    expect(claimCounts(record)).toEqual({ n: 3, m: 6 });
  });
});

describe("stripView", () => {
  const shown = (over: Partial<{ rec: RunRecord; fresh: boolean; stale: boolean }> = {}) => ({
    rec: record,
    source: "backend" as const,
    stale: false,
    fresh: false,
    ...over,
  });
  const base = { phase: "ready" as const, shown: null, capped: false, failed: false, valid: true, online: true, elapsed: 0 };

  it("is hidden when the pair has no trials", () => expect(stripView({ ...base, valid: false })).toEqual({ kind: "hidden" }));
  it("loading", () => expect(stripView({ ...base, phase: "loading" })).toEqual({ kind: "loading" }));
  it("intro online runs, offline points to methods", () => {
    expect(stripView(base)).toEqual({ kind: "intro", action: "run" });
    expect(stripView({ ...base, online: false })).toEqual({ kind: "intro", action: "methods" });
  });
  it("running shows whole seconds", () => expect(stripView({ ...base, phase: "running", elapsed: 12400 })).toEqual({ kind: "running", seconds: 12 }));
  it("a shown run with a judgement reads the stance", () => {
    expect(stripView({ ...base, shown: shown() })).toEqual({
      kind: "read",
      stance: "mixed",
      confidence: "low",
      n: 3,
      m: 6,
      when: "Recorded 9 Nov 2026",
      stale: false,
      tail: null,
    });
  });
  it("a withheld judgement has no stance or confidence", () => {
    const v = stripView({ ...base, shown: shown({ rec: { ...record, judgement_shown: false } }) });
    expect(v).toMatchObject({ kind: "read", stance: null, confidence: null });
  });
  it("maps every stance to its words", () => {
    const rec = (stance: "favours" | "mixed" | "against"): RunRecord => ({ ...record, memo: { ...record.memo!, judgement: { ...record.memo!.judgement, stance } } });
    const stance = (s: "favours" | "mixed" | "against") => (stripView({ ...base, shown: shown({ rec: rec(s) }) }) as { stance: string }).stance;
    expect(stance("favours")).toBe("favours further investment");
    expect(stance("against")).toBe("argues against further investment");
  });
  it("a null memo has no stance", () => {
    expect(stripView({ ...base, shown: shown({ rec: { ...record, memo: null } }) })).toMatchObject({ stance: null, confidence: null });
  });
  it("fresh and stale", () => {
    expect(stripView({ ...base, shown: shown({ fresh: true }) })).toMatchObject({ when: "New run, 9 Nov 2026" });
    expect(stripView({ ...base, shown: shown({ stale: true }) })).toMatchObject({ stale: true });
  });
  it("tails after a failed or capped attempt", () => {
    expect(stripView({ ...base, shown: shown(), failed: true })).toMatchObject({ kind: "read", tail: "failed" });
    expect(stripView({ ...base, shown: shown(), capped: true })).toMatchObject({ kind: "read", tail: "capped" });
  });
  it("failed or capped without a run", () => {
    expect(stripView({ ...base, failed: true })).toEqual({ kind: "failed" });
    expect(stripView({ ...base, capped: true })).toEqual({ kind: "capped" });
  });
});
