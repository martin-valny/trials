import { formatPct, formatRange, scaleMax, scalePos } from "../../lib/risk";
import "./risk.css";

interface Props {
  p: number;
  lo: number;
  hi: number;
  typical: number;
}

const at = (x: number): string => `${(scalePos(x) * 100).toFixed(2)}%`;

/** The 0–60% hairline scale: the range as a thin band, the estimate as a running ring, the typical rate as an ink tick.
 *  Past the axis end the estimate turns into a right-pointing head, and a range that runs on past it ends in a smaller,
 *  band-toned head of the same kind (open end) instead of being cut silently. */
export function RiskScale({ p, lo, hi, typical }: Props) {
  const over = p > scaleMax;
  const openEnd = hi > scaleMax;
  return (
    <div
      className="rk-scale"
      role="img"
      aria-label={`Estimated ${formatPct(p)} (${formatRange(lo, hi)}); typical ${formatPct(typical)}`}
    >
      <span className="rk-track" />
      <span className="rk-range" style={{ left: at(lo), width: `${((scalePos(hi) - scalePos(lo)) * 100).toFixed(2)}%` }} />
      {openEnd ? <span className="rk-range-end" /> : null}
      <span className="rk-typ" style={{ left: at(typical) }} />
      <span className={`rk-est${over ? " over" : ""}`} style={{ left: at(p) }} />
    </div>
  );
}

/** The scale's axis, set once above a column of scales. */
export function RiskAxis() {
  return (
    <div className="rk-axis" aria-hidden="true">
      {[0, 0.2, 0.4, 0.6].map((x) => (
        <span key={x} style={{ left: at(x) }}>
          {Math.round(x * 100)}%
        </span>
      ))}
    </div>
  );
}
