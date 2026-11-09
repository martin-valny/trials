import { formatPct, formatRange, scaleMax, scalePos } from "../../lib/risk";
import "./risk.css";

interface Props {
  p: number;
  lo: number;
  hi: number;
  typical: number;
}

const at = (x: number): string => `${(scalePos(x) * 100).toFixed(2)}%`;

/** The 0–60% hairline scale: the range as a thin band, the estimate as a running ring, the typical rate as an ink tick. */
export function RiskScale({ p, lo, hi, typical }: Props) {
  const over = p > scaleMax;
  return (
    <div
      className="rk-scale"
      role="img"
      aria-label={`Estimated ${formatPct(p)} (${formatRange(lo, hi)}); typical ${formatPct(typical)}`}
    >
      <span className="rk-track" />
      <span className="rk-range" style={{ left: at(lo), width: `${((scalePos(hi) - scalePos(lo)) * 100).toFixed(2)}%` }} />
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
