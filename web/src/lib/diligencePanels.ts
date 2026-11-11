// A leaf module (no imports): lib/diligence and lib/diligenceRelease both use it, so neither imports the other.

/** A target and disease with a recorded diligence run shipped with the site. */
export interface RecordedPair {
  target: string;
  disease: string;
}

export type PanelKey = "diligence" | "timeline" | "companies" | "stops" | "mechanism" | "diseases" | "risk";

const CLOSED_ORDER: PanelKey[] = ["timeline", "companies", "stops", "mechanism", "diseases", "risk", "diligence"];
const OPEN_ORDER: PanelKey[] = ["diligence", "timeline", "companies", "stops", "mechanism", "diseases", "risk"];

/** Each panel's letter: the diligence panel leads (a) once the agent is open, and trails (g) while it is closed. */
export function panelLetters(open: boolean): Record<PanelKey, string> {
  const order = open ? OPEN_ORDER : CLOSED_ORDER;
  return Object.fromEntries(order.map((k, i) => [k, String.fromCharCode(97 + i)])) as Record<PanelKey, string>;
}

/** A pair's target page, opened at the diligence panel. */
export function pairHref(p: RecordedPair, open: boolean): string {
  const q = new URLSearchParams();
  if (p.disease !== "all") q.set("disease", p.disease);
  q.set("panel", panelLetters(open).diligence);
  return `/target/${p.target}?${q}`;
}
