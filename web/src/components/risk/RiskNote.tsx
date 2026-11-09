import { Link } from "react-router-dom";
import "./risk.css";

/** The standing note under every stop-risk estimate (copy is fixed; see the spec's wording rules). */
export function RiskNote() {
  return (
    <p className="rk-note">
      Statistical estimate from public registry data. Not a statement about any sponsor or trial. The model is often wrong;{" "}
      <Link to="/methods#stop-risk">see Methods for accuracy</Link>.
    </p>
  );
}
