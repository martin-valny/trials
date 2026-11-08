import { normalizeFile } from "./lib/explorer";
import type { ChangesFile, ExplorerFile, GraphFile, Meta, PipelineFile, TrialFile, TrialsIndex, Window } from "./types";

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

export const loadExplorer = (): Promise<ExplorerFile | null> =>
  fetchJson<ExplorerFile>("explorer.json").then((f) => (f === null ? null : normalizeFile(f)));

/** The Targeted drugs graph (mechanisms.json); null before the first build that writes it. */
export const loadGraph = (): Promise<GraphFile | null> => fetchJson<GraphFile>("mechanisms.json");

/** The pipeline figure's data (pipeline.json); null when the refresh did not write it (R19). */
export const loadPipeline = (): Promise<PipelineFile | null> => fetchJson<PipelineFile>("pipeline.json");
