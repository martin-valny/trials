import type { ChangesFile, Meta, TrialFile, TrialsIndex, Window } from "./types";

const base = (): string => import.meta.env.BASE_URL + "data/";

/** Fetch a JSON file under data/. Returns null when the file does not exist (404). */
export async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(base() + path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadChanges = (window: Window): Promise<ChangesFile | null> =>
  fetchJson<ChangesFile>(`changes/${window}d.json`);

export const loadTrial = (nct: string): Promise<TrialFile | null> =>
  fetchJson<TrialFile>(`trials/${encodeURIComponent(nct)}.json`);

export const loadMeta = (): Promise<Meta | null> => fetchJson<Meta>("meta.json");

export const loadTrials = (): Promise<TrialsIndex | null> => fetchJson<TrialsIndex>("trials.json");
