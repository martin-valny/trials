// The front door's diligence band (spec section 6.2): shown between the page head and the figure once the agent is
// open (recorded or live), in place of the one-line example. A target and disease picker opens that target page at
// the diligence panel; it never starts a run (only the Run button on a target page does).
import { useId } from "react";
import { Link } from "react-router-dom";
import { FIXED_LABEL } from "../../lib/diligencePanels";
import type { RecordedPair } from "../../lib/diligenceRelease";
import type { PipelineRow } from "../../types";
import { PairPicker } from "../diligence/PairPicker";
import "./diligence-band.css";

export function DiligenceBand({
  pairs,
  rows,
  diseases,
  live,
}: {
  pairs: RecordedPair[];
  rows: PipelineRow[];
  diseases: { code: string; label: string }[];
  live: boolean;
}) {
  const id = useId();
  return (
    <section className="dg-band" aria-labelledby={id}>
      <h2 id={id} className="dg-band-k">
        AI diligence
      </h2>
      <p className="dg-band-s">An agent drafts a cited memo on a target, then a checker removes every claim its sources do not support.</p>
      <div className="dg-band-act">
        <PairPicker pairs={pairs} rows={rows} diseases={diseases} live={live} />
        <Link className="dg-band-how" to="/diligence">
          Read how it works →
        </Link>
      </div>
      <p className="dg-band-label">{FIXED_LABEL}</p>
    </section>
  );
}
