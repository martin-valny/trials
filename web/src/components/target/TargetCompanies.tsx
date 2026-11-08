import { useState } from "react";
import { Link } from "react-router-dom";
import { COMPANIES_ON_TARGET, DEFAULT_FIGURE_STATE, figureSearch, markState, normKey, targetCompanies } from "../../lib/pipeline";
import type { PipelineFile, PipelineMark } from "../../types";
import { Mark } from "../pipeline/Mark";

const OTHER = "Academic and other";
const DRUGS_SHOWN = 2;

interface Props {
  file: PipelineFile;
  marks: PipelineMark[];
  disease: string | null;
  onOpen: (nct: string, el: Element) => void;
}

/** Panel b: one line per parent company, its drugs, its trials as marks. */
export function TargetCompanies({ file, marks, disease, onOpen }: Props) {
  const [all, setAll] = useState(false);
  const list = targetCompanies(file, marks);
  const shown = all ? list : list.slice(0, COMPANIES_ON_TARGET);
  return (
    <div>
      {shown.map((c) => (
        <div className="co" key={c.parent}>
          <div className="co-nm">
            {c.parent === OTHER ? c.parent : <Link to={`/?${figureSearch({ ...DEFAULT_FIGURE_STATE, company: c.parent, disease })}`}>{c.parent}</Link>}
            <small>{[...new Map(c.drugs.map((d) => [normKey(d), d])).values()].slice(0, DRUGS_SHOWN).join(", ")}</small>
          </div>
          <div className="co-bar">
            {c.marks.map((m) => (
              <Mark key={m.n + m.drug} m={m} state={markState(m, disease)} size={8} onClick={(e) => onOpen(m.n, e.currentTarget)} />
            ))}
          </div>
          <div className="co-n">
            <b>{c.marks.length}</b> · {c.run} running
          </div>
        </div>
      ))}
      {list.length > COMPANIES_ON_TARGET && (
        <button type="button" className="more-btn" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `+${list.length - COMPANIES_ON_TARGET} more`}
        </button>
      )}
    </div>
  );
}
