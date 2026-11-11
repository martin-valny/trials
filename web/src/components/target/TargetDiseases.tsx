import { diseaseLines, hasApprovalData, sourceText } from "../../lib/pipeline";
import type { DiseaseLine } from "../../lib/pipeline";
import type { PipelineFile, PipelineRow } from "../../types";

const n = (x: number): string => x.toLocaleString("en-US");

const STEPS = ["Phase 1", "Phase 2", "Phase 3", "Approved use"] as const;
const STEPS_PHONE = ["P1", "P2", "P3", "Approved use"] as const;

/** Four bars: the furthest phase reached in ink, earlier ones in the family ink, later ones pale. */
function Ladder({ line, labels }: { line: DiseaseLine; labels?: readonly string[] }) {
  return (
    <div className="lad" role="img" aria-label={`Trials by phase: ${STEPS.map((s, i) => `${s} ${line.byPhase[i]}`).join(", ")}`}>
      {STEPS.map((s, i) => (
        <div key={s} className="st">
          <i className={i + 1 === line.furthest ? "at" : i + 1 < line.furthest ? "was" : ""} />
          <span className="ct">{line.byPhase[i] ? n(line.byPhase[i]!) : ""}</span>
          {labels && <span className="lb">{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

function Approved({ line }: { line: DiseaseLine }) {
  if (line.approvals.length === 0) return <p className="none">None approved</p>;
  const floor = line.approvals.some((a) => !a.wd);
  return (
    <ul className={`apl${floor ? " floored" : ""}`}>
      {line.approvals.map((a) => (
        <li key={a.d}>
          <a href={a.url} target="_blank" rel="noreferrer">
            {a.d}
          </a>{" "}
          <small>{sourceText(a)}</small>
          {a.wd && <small className="wd"> withdrawn</small>}
        </li>
      ))}
    </ul>
  );
}

export function TargetDiseases({
  file,
  row,
  disease,
  phone,
  letter,
}: {
  file: PipelineFile;
  row: PipelineRow;
  disease: string | null;
  phone: boolean;
  /** The panel's letter (e while the diligence panel trails, f once it leads). */
  letter: string;
}) {
  const lines = diseaseLines(file, row);
  if (lines.length === 0) return null;
  const withAp = hasApprovalData(file);
  return (
    <section className="sec" aria-labelledby={`p${letter}`}>
      <div className="sec-h pe-h">
        <span className="ltr" aria-hidden="true">{letter}</span>
        <h2 id={`p${letter}`} tabIndex={-1}>{row.label} by disease</h2>
        <p>
          <span className="cap">furthest phase reached by trials on the registry{withAp ? " · approved for the disease, by any regulator" : ""}</span>
          {!withAp && <span className="na"> · Approval data not available</span>}
        </p>
      </div>
      {phone ? (
        <div className="dzp">
          {lines.map((l) => (
            <div key={l.code} className="dzl" aria-current={l.code === disease ? "true" : undefined}>
              <div className="top">
                <b>{l.label}</b>
                <span className="rn">
                  {n(l.trials)} {l.trials === 1 ? "trial" : "trials"}
                  {l.running > 0 && (
                    <>
                      {" · "}
                      <em>{n(l.running)} running</em>
                    </>
                  )}
                </span>
              </div>
              <Ladder line={l} labels={STEPS_PHONE} />
              {withAp && <Approved line={l} />}
            </div>
          ))}
        </div>
      ) : (
        <div className={`dzt${withAp ? "" : " noap"}`}>
          <div className="dzh">
            <span>Disease</span>
            <span>Trials</span>
            <div className="lad">
              {STEPS.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
            {withAp && <span>Approved for this disease</span>}
          </div>
          {lines.map((l) => (
            <div key={l.code} className="dzl" aria-current={l.code === disease ? "true" : undefined}>
              <b className="nm">{l.label}</b>
              <div className="tc">
                <span>{n(l.trials)}</span>
                {l.running > 0 && <em>{n(l.running)} running</em>}
              </div>
              <Ladder line={l} />
              {withAp && <Approved line={l} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
