import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { stripView } from "../../lib/diligence";
import { usePhone } from "../../lib/useMediaQuery";
import { useDiligence } from "./DiligenceRunContext";
import { FIXED_LABEL } from "./TargetDiligence";

const WHAT = "AI diligence: an agent searches ClinicalTrials.gov, ChEMBL, Europe PMC and openFDA, writes a cited memo, and a second model checks every claim.";
const WHAT_PHONE = "AI diligence: a cited memo from public sources, checked claim by claim.";
const CAPPED = "daily run limit reached, try again tomorrow";

/** One line in the target header that says what panel g's diligence run is doing, and goes there (spec section 5). */
export function DiligenceStrip({ onGo }: { onGo(): void }) {
  const d = useDiligence();
  const phone = usePhone();
  const v = stripView(d);
  if (v.kind === "hidden") return null;
  // A pale line at the strip's height while the recorded run is looked for, so nothing below moves.
  if (v.kind === "loading") return <p className="dstrip" data-state="loading" aria-hidden="true" />;

  const go = (label: string) => (
    <button type="button" className="dstrip-go" onClick={onGo}>
      {label}
    </button>
  );
  const start = (label: string) => (
    <button
      type="button"
      className="dstrip-go"
      onClick={() => {
        void d.run(false);
        onGo();
      }}
    >
      {label}
    </button>
  );
  const what = phone ? WHAT_PHONE : WHAT;

  let text: string;
  let action: ReactNode = null;
  let label = false;
  switch (v.kind) {
    case "intro":
      if (v.action === "run") {
        text = what;
        action = start("Run diligence →");
      } else {
        text = `${what} Offline at the moment.`;
        action = <Link to="/methods#diligence">How it works →</Link>;
      }
      break;
    case "unrecorded":
      text = "No diligence run recorded for this pair.";
      break;
    case "running":
      text = `AI diligence running · ${v.seconds} s`;
      action = go("Follow it →");
      break;
    case "failed":
      text = "The last diligence run failed.";
      if (d.canRun) action = start("Run again →");
      break;
    case "capped":
      text = "Daily run limit reached, try again tomorrow.";
      break;
    case "read":
      text = [
        `AI read: ${v.stance ?? "judgement withheld"}`,
        v.stance && v.confidence ? `${v.confidence} confidence` : null,
        `${v.n} of ${v.m} claims supported`,
        v.when,
        v.stale ? "data has changed since" : null,
        v.tail === "failed" ? "the latest run failed" : v.tail === "capped" ? CAPPED : null,
      ]
        .filter(Boolean)
        .join(" · ");
      action = go("Read the memo →");
      label = true;
      break;
  }
  return (
    <p className="dstrip" data-state={v.kind}>
      <span className="dstrip-text">{text}</span>
      {action && <> {action}</>}
      {label && <span className="dstrip-label">{FIXED_LABEL}</span>}
    </p>
  );
}
