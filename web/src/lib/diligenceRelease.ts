import { useEffect, useState } from "react";
import { diligenceEndpoint } from "./diligence";

/** Whether the diligence agent is shown: pending (index not yet read), closed (nothing recorded, no backend),
 *  recorded (shipped runs only) or live (a backend is configured). */
export type DiligenceRelease = "pending" | "closed" | "recorded" | "live";

export interface RecordedPair {
  target: string;
  disease: string;
}

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

export type PanelKey = "diligence" | "timeline" | "companies" | "stops" | "mechanism" | "diseases" | "risk";

const CLOSED_ORDER: PanelKey[] = ["timeline", "companies", "stops", "mechanism", "diseases", "risk", "diligence"];
const OPEN_ORDER: PanelKey[] = ["diligence", "timeline", "companies", "stops", "mechanism", "diseases", "risk"];

/** Each panel's letter: the diligence panel leads (a) once the agent is open, and trails (g) while it is closed. */
export function panelLetters(open: boolean): Record<PanelKey, string> {
  const order = open ? OPEN_ORDER : CLOSED_ORDER;
  return Object.fromEntries(order.map((k, i) => [k, String.fromCharCode(97 + i)])) as Record<PanelKey, string>;
}

/** A pair's target page, opened at the diligence panel. */
export function pairHref(p: RecordedPair, open: boolean): string {
  const q = new URLSearchParams();
  if (p.disease !== "all") q.set("disease", p.disease);
  q.set("panel", panelLetters(open).diligence);
  return `/target/${p.target}?${q}`;
}
