import { Link } from "react-router-dom";
import "./risk.css";

/** The standing note under every stop-risk estimate (copy is fixed; see the spec's wording rules). */
export function RiskNote() {
  return (
    <p className="rk-note">
      A statistical pattern from similar past trials, read from the registry record alone. It knows nothing about the drug's results and is not a judgement of the sponsor. It ranks a trial that stopped above one that completed about 7 times in 10, so it is often wrong;{" "}
      <Link to="/methods#stop-risk">how it is measured</Link>.
    </p>
  );
}
