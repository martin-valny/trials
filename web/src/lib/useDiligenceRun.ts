import { useCallback, useEffect, useRef, useState } from "react";
import { diligenceEndpoint, diligenceKey, isValidDisease, loadLatest, loadRecorded, pollRun, startRun } from "./diligence";
import type { DiligenceStep, PipelineRow, RunRecord } from "../types";

export interface Shown {
  rec: RunRecord;
  /** "recorded": committed with the site (cannot be flagged); "backend": a replay or a run from the agent API. */
  source: "recorded" | "backend";
  stale: boolean;
  /** Started by this visitor just now (not a replay). */
  fresh: boolean;
}

interface State {
  phase: "loading" | "ready" | "running";
  shown: Shown | null;
  /** Steps of the attempt in progress, or of one that ended without a run to show. */
  attempt: DiligenceStep[] | null;
  notice: string | null;
  /** The daily limit was reached: no more runs are offered on this visit. */
  capped: boolean;
  /** The last attempt ended in fail(); cleared by any success or replay. */
  failed: boolean;
}

export interface DiligenceRun {
  phase: State["phase"];
  shown: Shown | null;
  attempt: DiligenceStep[] | null;
  notice: string | null;
  capped: boolean;
  failed: boolean;
  valid: boolean;
  online: boolean;
  elapsed: number;
  lastText: string;
  canRun: boolean;
  run(force: boolean): Promise<void>;
}

/** The diligence agent's run state for one target and disease: the recorded run, a live run and its trace. Resets itself when the target or disease changes. */
export function useDiligenceRun(row: PipelineRow, disease: string | null): DiligenceRun {
  const dz = disease ?? "all";
  const valid = isValidDisease(row, dz);
  const online = diligenceEndpoint() !== null;
  const initial = (): State => ({ phase: valid ? "loading" : "ready", shown: null, attempt: null, notice: null, capped: false, failed: false });
  const [s, setS] = useState<State>(initial);
  const committed = useRef<RunRecord | null>(null);
  const alive = useRef(true);
  const poll = useRef<AbortController | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastText, setLastText] = useState("");
  /** Bumped when the target or disease changes (and on unmount): a run started under an older value must not land in the new state. */
  const gen = useRef(0);

  // A different target or disease starts from scratch (adjusting state while rendering, so no stale frame is painted).
  const key = diligenceKey(row.id, dz);
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setS(initial());
    setElapsed(0);
    setLastText("");
  }

  useEffect(() => {
    return () => {
      gen.current += 1;
      poll.current?.abort();
      committed.current = null;
    };
  }, [key]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      poll.current?.abort();
    };
  }, []);

  // Online, the backend's cached run (newer) is asked for first; the committed recording is the fallback (spec §7).
  useEffect(() => {
    if (!valid) return;
    let on = true;
    void Promise.all([loadRecorded(row.id, dz), online ? loadLatest(row.id, dz) : Promise.resolve(null)]).then(([rec, latest]) => {
      if (!on) return;
      committed.current = rec;
      const shown: Shown | null = latest
        ? { rec: latest.replay, source: "backend", stale: latest.stale, fresh: false }
        : rec
          ? { rec, source: "recorded", stale: false, fresh: false }
          : null;
      setS((p) => ({ ...p, phase: "ready", shown }));
    });
    return () => {
      on = false;
    };
  }, [row.id, dz, valid, online]);

  // A plain clock while the agent works (no decorative spinner).
  useEffect(() => {
    if (s.phase !== "running") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 1000);
    return () => clearInterval(id);
  }, [s.phase]);

  const run = useCallback(
    async (force: boolean) => {
      const before = s.shown;
      const g = gen.current;
      const live = () => alive.current && gen.current === g;
      const fail = (notice: string, partial: DiligenceStep[] | null) =>
        setS({ phase: "ready", notice, shown: before, attempt: before ? null : partial, capped: false, failed: true });
      setElapsed(0);
      setLastText("");
      setS({ phase: "running", shown: before, attempt: [], notice: null, capped: false, failed: false });
      let res;
      try {
        res = await startRun(row.id, dz, force);
      } catch {
        if (live()) fail(`The diligence agent could not be reached.${before ? " Showing the recorded run." : ""}`, null);
        return;
      }
      if (!live()) return;
      if ("replay" in res) {
        setS({ phase: "ready", notice: null, attempt: null, capped: false, failed: false, shown: { rec: res.replay, source: "backend", stale: res.stale, fresh: false } });
        return;
      }
      if ("capped" in res) {
        const latest: Shown | null = res.capped
          ? { rec: res.capped, source: "backend", stale: false, fresh: false }
          : committed.current
            ? { rec: committed.current, source: "recorded", stale: false, fresh: false }
            : null;
        setS({
          phase: "ready",
          notice: latest
            ? "Daily limit reached — showing the latest recorded run"
            : "Daily limit reached — no recorded run is available yet. Try again tomorrow.",
          attempt: null,
          shown: latest,
          capped: true,
          failed: false,
        });
        return;
      }
      const steps: DiligenceStep[] = [];
      poll.current?.abort();
      const ctl = new AbortController();
      poll.current = ctl;
      try {
        const rec = await pollRun(res.run_id, (step) => {
          if (!live()) return;
          steps.push(step);
          // The step number makes two identical texts in a row distinct, so each is announced.
          setLastText(`Step ${step.n}: ${step.text}`);
          setS((p) => ({ ...p, attempt: [...steps] }));
        }, { signal: ctl.signal });
        if (!live()) return;
        setS({ phase: "ready", notice: null, attempt: null, capped: false, failed: false, shown: { rec, source: "backend", stale: false, fresh: true } });
      } catch (e) {
        if (!live() || ctl.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "";
        const then = before ? " Showing the recorded run." : " Try again later.";
        fail(
          msg === "timeout"
            ? `The run did not finish.${then}`
            : msg === "not_found"
              ? `The run could not be found.${then}`
              : `The diligence agent could not be reached.${then}`,
          [...steps],
        );
      }
    },
    [row.id, dz, s.shown],
  );

  const canRun = online && valid && s.phase === "ready" && !s.capped;
  return { phase: s.phase, shown: s.shown, attempt: s.attempt, notice: s.notice, capped: s.capped, failed: s.failed, valid, online, elapsed, lastText, canRun, run };
}
