import type { DiligenceRemoved, DiligenceSection, DiligenceSentence, DiligenceStep, DiligenceVerdict, PipelineRow, RunRecord } from "../types";

export const SECTION_ORDER: DiligenceSection[] = ["landscape", "track_record", "literature", "competition"];

export const diligenceKey = (target: string, disease: string): string => `${target}__${disease}`;

/** The agent API base (always with a trailing slash); null when the site is built without one (offline). */
export function diligenceEndpoint(): string | null {
  const raw = import.meta.env.VITE_DILIGENCE_URL;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const u = raw.trim();
  return u.endsWith("/") ? u : u + "/";
}

/** An abort signal that fires after ms (setTimeout-based so fake timers can drive it), or when ``outer`` aborts. */
function deadline(ms: number, outer?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  const onOuter = () => c.abort();
  outer?.addEventListener("abort", onOuter);
  if (outer?.aborted) c.abort();
  return {
    signal: c.signal,
    clear: () => {
      clearTimeout(t);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

const REQUEST_TIMEOUT_MS = 15000;
const POLL_REQUEST_MS = 10000;
/** The page-view lookup must not hold the panel up for long; on a timeout the committed run is shown. */
const LATEST_TIMEOUT_MS = 5000;
/** How long the panel follows a run: the Lambda Timeout (240 s, agent/template.yaml). */
export const POLL_TIMEOUT_MS = 240000;

/** fetch bounded by a deadline; the whole call (including reading the body via ``read``) is covered. */
async function bounded<T>(ms: number, url: string, init: RequestInit, read: (res: Response) => Promise<T>, outer?: AbortSignal): Promise<T> {
  const d = deadline(ms, outer);
  try {
    return await read(await fetch(url, { ...init, signal: d.signal }));
  } finally {
    d.clear();
  }
}

function endpoint(): string {
  const e = diligenceEndpoint();
  if (e === null) throw new Error("diligence agent is offline");
  return e;
}

/** A recorded run shipped with the site; null when absent or unreadable (never throws). */
export async function loadRecorded(target: string, disease: string): Promise<RunRecord | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}diligence/${diligenceKey(target, disease)}.json`);
    if (!res.ok) return null;
    return (await res.json()) as RunRecord;
  } catch {
    return null;
  }
}

export interface KnownRun {
  replay: RunRecord;
  /** The row's data changed since this run. */
  stale: boolean;
}

/** The backend's cached or latest run for the pair (GET /runs/latest: read-only, no quota); null when there is none, the
 * agent is offline or unreachable (never throws). */
export async function loadLatest(target: string, disease: string): Promise<KnownRun | null> {
  const e = diligenceEndpoint();
  if (e === null) return null;
  const url = `${e}runs/latest?target=${encodeURIComponent(target)}&disease=${encodeURIComponent(disease)}`;
  try {
    return await bounded(LATEST_TIMEOUT_MS, url, {}, async (res) => {
      if (res.status !== 200) return null;
      const b = (await res.json()) as Partial<KnownRun>;
      return b.replay ? { replay: b.replay, stale: b.stale === true } : null;
    });
  } catch {
    return null;
  }
}

export type StartResult = { run_id: string } | { replay: RunRecord; stale: boolean } | { capped: RunRecord | null };

export async function startRun(target: string, disease: string, force: boolean): Promise<StartResult> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, disease, force }),
  };
  return bounded(REQUEST_TIMEOUT_MS, endpoint() + "runs", init, async (res) => {
    if (res.status === 202) return { run_id: ((await res.json()) as { run_id: string }).run_id };
    if (res.status === 200) {
      const b = (await res.json()) as { replay: RunRecord; stale: boolean };
      return { replay: b.replay, stale: b.stale };
    }
    if (res.status === 429) {
      const b = (await res.json().catch(() => ({}))) as { latest?: RunRecord | null };
      return { capped: b.latest ?? null };
    }
    throw new Error(`Could not start run: HTTP ${res.status}`);
  });
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Stops polling (rejects with "aborted"), e.g. when the panel unmounts or the target changes. */
  signal?: AbortSignal;
}

/** Poll a run until it is done or failed. Network errors, 429 and 5xx are transient; rejects with "timeout", or "aborted" when ``signal`` fires. */
export async function pollRun(runId: string, onStep: (step: DiligenceStep) => void, opts: PollOptions = {}): Promise<RunRecord> {
  const { intervalMs = 1000, timeoutMs = POLL_TIMEOUT_MS, signal } = opts;
  const aborted = () => new Error("aborted");
  const url = endpoint() + "runs/" + encodeURIComponent(runId);
  const start = Date.now();
  let lastN = 0;
  for (;;) {
    if (signal?.aborted) throw aborted();
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) throw new Error("timeout");
    let notFound = false;
    try {
      const rec = await bounded(Math.min(POLL_REQUEST_MS, remaining), url, {}, async (res) => {
        if (res.status === 404) {
          notFound = true;
          return null;
        }
        return res.status === 200 ? ((await res.json()) as RunRecord) : null;
      }, signal);
      if (notFound) throw new Error("not_found");
      if (rec) {
        for (const s of rec.steps) {
          if (s.n > lastN) {
            lastN = s.n;
            onStep(s);
          }
        }
        if (rec.status !== "running") return rec;
      }
    } catch (e) {
      if (notFound) throw e;
      // transient: network error, per-request deadline, bad body
    }
    if (signal?.aborted) throw aborted();
    if (Date.now() - start + intervalMs > timeoutMs) throw new Error("timeout");
    await new Promise<void>((r) => {
      const t = setTimeout(done, intervalMs);
      function done() {
        clearTimeout(t);
        signal?.removeEventListener("abort", done);
        r();
      }
      signal?.addEventListener("abort", done);
    });
  }
}

export async function flagSentence(runId: string, sentenceId: string, reason: string): Promise<void> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId, sentence_id: sentenceId, reason }),
  };
  await bounded(REQUEST_TIMEOUT_MS, endpoint() + "flags", init, async (res) => {
    if (res.status !== 204) throw new Error(`Could not send flag: HTTP ${res.status}`);
  });
}

export interface Renderable {
  sections: Record<DiligenceSection, DiligenceSentence[]>;
  removed: DiligenceRemoved[];
  judgementShown: boolean;
  verdictBySentence: Map<string, DiligenceVerdict>;
}

export function renderable(record: RunRecord): Renderable {
  const sections = Object.fromEntries(SECTION_ORDER.map((k) => [k, []])) as unknown as Record<DiligenceSection, DiligenceSentence[]>;
  for (const s of record.memo?.sections ?? []) sections[s.section].push(s);
  return {
    sections,
    removed: record.removed,
    judgementShown: record.judgement_shown && record.memo !== null,
    verdictBySentence: new Map(record.verdicts.map((v) => [v.sentence_id, v])),
  };
}

/** "all", or a disease that at least one mark of the row carries. */
export function isValidDisease(row: PipelineRow, disease: string): boolean {
  return disease === "all" || row.marks.some((m) => m.dz.includes(disease));
}
