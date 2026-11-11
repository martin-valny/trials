import { useEffect, useState } from "react";
import { loadPipeline } from "../data";
import type { PipelineFile } from "../types";
import { diligenceEndpoint } from "./diligence";
import type { RecordedPair } from "./diligencePanels";

export { pairHref, panelLetters, type PanelKey, type RecordedPair } from "./diligencePanels";

/** Whether the diligence agent is shown: pending (index not yet read), closed (nothing recorded, no backend),
 *  recorded (shipped runs only) or live (a backend is configured). */
export type DiligenceRelease = "pending" | "closed" | "recorded" | "live";

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";

/** The shipped index (diligence/index.json); null unless it is {runs: [...]} with every entry two non-empty strings. */
export function parseIndex(raw: unknown): RecordedPair[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const runs = (raw as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return null;
  const seen = new Set<string>();
  const pairs: RecordedPair[] = [];
  for (const r of runs) {
    if (typeof r !== "object" || r === null) return null;
    const { target, disease } = r as { target?: unknown; disease?: unknown };
    if (!nonEmpty(target) || !nonEmpty(disease)) return null;
    const key = `${target}\u0000${disease}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ target, disease });
  }
  return pairs;
}

/** The pairs whose target is a row of pipeline.json and, unless "all", whose disease that row has (its trials or
 *  approvals); a target that left the daily pipeline would otherwise link to a page that does not exist. */
export function knownPairs(pairs: RecordedPair[], pipeline: PipelineFile | null): RecordedPair[] {
  if (!pipeline || !Array.isArray(pipeline.rows)) return [];
  const rows = new Map(pipeline.rows.map((r) => [r.id, r]));
  return pairs.filter(({ target, disease }) => {
    const row = rows.get(target);
    if (!row) return false;
    return disease === "all" || row.marks.some((m) => m.dz.includes(disease)) || (row.ap !== undefined && Object.hasOwn(row.ap, disease));
  });
}

/** How long the index may take before the site treats it as absent (closed), so no page waits on it forever. */
export const INDEX_TIMEOUT_MS = 3000;

async function fetchIndex(): Promise<RecordedPair[] | null> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve(null);
    }, INDEX_TIMEOUT_MS);
  });
  const read = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}diligence/index.json`, { signal: abort.signal });
      if (!res.ok) return null;
      return parseIndex(await res.json());
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

let cached: Promise<RecordedPair[]> | null = null;

/** Tests only: forget the cached index. */
export function __resetDiligenceIndex(): void {
  cached = null;
}

/**
 * The recorded pairs shipped with the site that still name a known target (knownPairs), read once per page load;
 * empty when the index is absent, unreadable or slower than INDEX_TIMEOUT_MS, or pipeline.json is missing (never throws).
 */
export function loadIndex(): Promise<RecordedPair[]> {
  cached ??= (async () => {
    const pairs = await fetchIndex();
    if (!pairs || pairs.length === 0) return [];
    const pipeline = await loadPipeline().catch(() => null);
    return knownPairs(pairs, pipeline);
  })();
  return cached;
}

export function useDiligenceRelease(): { release: DiligenceRelease; pairs: RecordedPair[] } {
  const live = diligenceEndpoint() !== null;
  const [state, setState] = useState<{ settled: boolean; pairs: RecordedPair[] }>({ settled: false, pairs: [] });
  useEffect(() => {
    let off = false;
    void loadIndex().then((p) => {
      if (!off) setState({ settled: true, pairs: p });
    });
    return () => {
      off = true;
    };
  }, []);
  const release: DiligenceRelease = live ? "live" : !state.settled ? "pending" : state.pairs.length > 0 ? "recorded" : "closed";
  return { release, pairs: state.pairs };
}

export const isOpen = (r: DiligenceRelease): boolean => r === "recorded" || r === "live";
