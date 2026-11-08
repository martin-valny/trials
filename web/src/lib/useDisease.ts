// The Disease filter's URL hand-off for the pages with a multi-select (the map and the graph, spec §5):
// one ``?disease=<code>`` arrives preselected; it is written back only while exactly one disease is chosen.
import { useEffect, useMemo, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { loadPipeline } from "../data";
import type { PipelineFile } from "../types";
import type { Filters } from "./explorer";

/** pipeline.json: undefined while loading, null when missing or unreadable (the codes are then unknown). */
export type PipelineState = PipelineFile | null | undefined;

export function usePipelineFile(): PipelineState {
  const [f, setF] = useState<PipelineState>(undefined);
  useEffect(() => {
    let alive = true;
    loadPipeline()
      .then((p) => alive && setF(p && Array.isArray(p.rows) && Array.isArray(p.diseases) ? p : null))
      .catch(() => alive && setF(null));
    return () => {
      alive = false;
    };
  }, []);
  return f;
}

/** The code of the one disease chosen (by label), or null with none or several, or an unknown label. */
export function singleDiseaseCode(pipeline: PipelineState, conditions: ReadonlySet<string>, all: ReadonlySet<string>): string | null {
  if (!pipeline || conditions.size !== 1 || all.size === 1) return null;
  const [label] = [...conditions];
  return pipeline.diseases.find((d) => d.label === label)?.code ?? null;
}

/**
 * Preselect the disease ``?disease=`` names once pipeline.json is in (an unknown code is ignored), then
 * keep the query in step with the Disease filter. Returns the code outgoing links carry (null: none).
 */
export function useDiseaseParam(
  pipeline: PipelineState,
  params: URLSearchParams,
  setParams: SetURLSearchParams,
  filters: Filters,
  setFilters: (f: Filters) => void,
  all: ReadonlySet<string>,
): string | null {
  const [arrived, setArrived] = useState(false);
  const code = useMemo(() => singleDiseaseCode(pipeline, filters.conditions, all), [pipeline, filters.conditions, all]);
  const wanted = params.get("disease");
  // Once pipeline.json is in, preselect (state adjusted while rendering, so the first paint after it is right).
  if (pipeline !== undefined && !arrived) {
    const label = pipeline?.diseases.find((d) => d.code === wanted)?.label;
    if (label && all.has(label)) setFilters({ ...filters, conditions: new Set([label]) });
    setArrived(true);
  }
  useEffect(() => {
    if (!arrived || !pipeline || code === wanted) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (code) next.set("disease", code);
        else next.delete("disease");
        return next;
      },
      { replace: true },
    );
  }, [arrived, code, wanted, pipeline, setParams]);
  return code;
}
