import type { RiskFactor } from "../../types";

/** Up to three factors, each saying in words which way it moves the estimate (the arrow is decoration). */
export function RiskFactors({ factors, labelledBy }: { factors: RiskFactor[]; labelledBy?: string }) {
  return (
    <ul className="rk-factors" {...(labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": "Main factors" })}>
      {factors.slice(0, 3).map((f) => (
        <li key={f.label}>
          <span className={`rk-dir ${f.dir}`}>
            <span aria-hidden="true">{f.dir === "up" ? "↑" : "↓"}</span> {f.dir === "up" ? "raises" : "lowers"}
          </span>
          <span>{f.label}</span>
        </li>
      ))}
    </ul>
  );
}
