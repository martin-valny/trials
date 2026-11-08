import { useState } from "react";
import { STOPS_SHOWN, stopSummary } from "../../lib/pipeline";
import type { PipelineFile, PipelineMark } from "../../types";
import { Mark } from "../pipeline/Mark";
import { phaseText } from "../pipeline/TrialCard";

interface Props {
  file: PipelineFile;
  label: string;
  marks: PipelineMark[];
  onOpen: (nct: string, el: Element) => void;
}

/** A bullet beside a reason: the two-phase span glyph would read as a stray tick there. */
const plain = (m: PipelineMark): PipelineMark => {
  const c = { ...m };
  delete c.span;
  return c;
};

/** Panel c: why trials stopped, in the registry's own words. */
export function TargetStops({ file, label, marks, onOpen }: Props) {
  const [all, setAll] = useState(false);
  const { groups, showGroups, stops } = stopSummary(file, marks);
  if (stops.length === 0) return <p className="empty-line">No {label} trial has stopped.</p>;
  const shown = all ? stops : stops.slice(0, STOPS_SHOWN);
  return (
    <div>
      {showGroups && groups.length > 0 && (
        <div className="reasons" aria-label="Reason groups">
          {groups.map(([g, k]) => (
            <span key={g}>
              {g} <b>{k}</b>
            </span>
          ))}
        </div>
      )}
      {shown.map((m) => (
        <div className="stop-card" key={m.n + m.drug}>
          <Mark m={plain(m)} state="stop" />
          <div>
            <button type="button" className="q" onClick={(e) => onOpen(m.n, e.currentTarget)}>
              {file.trials[m.n]?.why || "No reason given"}
            </button>
            <div className="meta">
              {m.drug} · {file.sponsors[m.sp]?.parent ?? "Unknown sponsor"} · {phaseText(m)} · {m.y ?? "year not given"} · {m.n}
            </div>
          </div>
        </div>
      ))}
      {stops.length > STOPS_SHOWN && (
        <button type="button" className="more-btn" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${stops.length}`}
        </button>
      )}
    </div>
  );
}
