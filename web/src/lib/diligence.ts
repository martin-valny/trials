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

export type StartResult = { run_id: string } | { replay: RunRecord; stale: boolean } | { capped: RunRecord | null };

export async function startRun(target: string, disease: string, force: boolean): Promise<StartResult> {
  const res = await fetch(endpoint() + "runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, disease, force }),
  });
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
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

/** Poll a run until it is done or failed. Network errors, 429 and 5xx are transient; rejects with "timeout". */
export async function pollRun(runId: string, onStep: (step: DiligenceStep) => void, opts: PollOptions = {}): Promise<RunRecord> {
  const { intervalMs = 1000, timeoutMs = 120000 } = opts;
  const url = endpoint() + "runs/" + encodeURIComponent(runId);
  const start = Date.now();
  let lastN = 0;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        const rec = (await res.json()) as RunRecord;
        for (const s of rec.steps) {
          if (s.n > lastN) {
            lastN = s.n;
            onStep(s);
          }
        }
        if (rec.status !== "running") return rec;
      }
    } catch {
      // transient
    }
    if (Date.now() - start + intervalMs > timeoutMs) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function flagSentence(runId: string, sentenceId: string, reason: string): Promise<void> {
  const res = await fetch(endpoint() + "flags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId, sentence_id: sentenceId, reason }),
  });
  if (res.status !== 204) throw new Error(`Could not send flag: HTTP ${res.status}`);
}

export interface Renderable {
  sections: Record<DiligenceSection, DiligenceSentence[]>;
  removed: DiligenceRemoved[];
  judgementShown: boolean;
  verdictBySentence: Map<string, DiligenceVerdict>;
}

export function renderable(record: RunRecord): Renderable {
  const sections = { landscape: [], track_record: [], literature: [], competition: [] } as Record<DiligenceSection, DiligenceSentence[]>;
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
