import { useEffect, useState } from "react";
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

let cached: Promise<RecordedPair[] | null> | null = null;

/** Tests only: forget the cached index. */
export function __resetDiligenceIndex(): void {
  cached = null;
}

/** The recorded pairs shipped with the site; fetched once per page load; null when absent or unreadable (never throws). */
export function loadIndex(): Promise<RecordedPair[] | null> {
  cached ??= (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}diligence/index.json`);
      if (!res.ok) return null;
      return parseIndex(await res.json());
    } catch {
      return null;
    }
  })();
  return cached;
}

export function useDiligenceRelease(): { release: DiligenceRelease; pairs: RecordedPair[] } {
  const live = diligenceEndpoint() !== null;
  const [state, setState] = useState<{ settled: boolean; pairs: RecordedPair[] }>({ settled: false, pairs: [] });
  useEffect(() => {
    let off = false;
    void loadIndex().then((p) => {
      if (!off) setState({ settled: true, pairs: p ?? [] });
    });
    return () => {
      off = true;
    };
  }, []);
  const release: DiligenceRelease = live ? "live" : !state.settled ? "pending" : state.pairs.length > 0 ? "recorded" : "closed";
  return { release, pairs: state.pairs };
}

export const isOpen = (r: DiligenceRelease): boolean => r === "recorded" || r === "live";
