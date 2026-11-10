import type { DateInfo, Outcome, MarkState } from "../types";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DASH = "—";

export function isDateInfo(v: unknown): v is DateInfo {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as DateInfo).date === "string" &&
    ((v as DateInfo).precision === "day" || (v as DateInfo).precision === "month")
  );
}

/** "2027-03-15" -> "15 Mar 2027"; month precision "2027-03" -> "Mar 2027". */
export function formatDate(d: DateInfo): string {
  const [y, m, day] = d.date.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!y || !month) return d.date;
  return d.precision === "month" || !day ? `${month} ${y}` : `${Number(day)} ${month} ${y}`;
}

/** Outcome changes are stored as [[measure, time_frame | null], ...]. */
function isOutcomePair(v: unknown): v is [string, string | null] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "string";
}

function formatOutcomes(v: unknown[]): string {
  return v
    .map((o) => (isOutcomePair(o) ? (o[1] ? `${o[0]} (${o[1]})` : o[0]) : formatValue("", o)))
    .join("; ");
}

export function formatValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return DASH;
  if (isDateInfo(v)) return formatDate(v);
  if (field.endsWith("_outcomes") && Array.isArray(v)) {
    return v.length === 0 ? DASH : formatOutcomes(v);
  }
  if (Array.isArray(v)) return v.length === 0 ? DASH : v.map((x) => formatValue(field, x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function formatDelta(days: number | null): string {
  if (days === null || days === 0) return "";
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  return days > 0 ? `slipped ${n} ${unit}` : `pulled in ${n} ${unit}`;
}

const STALE_MS = 36 * 60 * 60 * 1000;

/** True when the last successful run is more than 36 hours before ``now``. */
export function isStale(lastSuccessIso: string, now: Date): boolean {
  const t = Date.parse(lastSuccessIso);
  return Number.isNaN(t) || now.getTime() - t > STALE_MS;
}

/** "overall_status" -> "Overall status". */
export function fieldLabel(field: string): string {
  if (field === "_tracked") return "Registry presence";
  const s = field.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const REASONS: Record<string, string> = {
  status_change: "Status changed",
  primary_endpoint_change: "Primary endpoint changed",
  enrollment_change_ge_20pct: "Enrollment changed by 20% or more",
  date_slip_ge_90d: "Date moved by 90 days or more",
};

export function reasonLabel(reason: string | null): string {
  if (reason === null) return "";
  return REASONS[reason] ?? reason.replace(/_/g, " ");
}

/** "7 days" / "1 day". */
export const windowLabel = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;

const OUTCOME_LABELS: Record<Outcome, string> = {
  succeeded: "Advanced to next phase",
  stopped: "Stopped early",
  completed_unknown: "Finished, no follow-on",
  running: "Still running",
  unknown: "Status unknown",
};

export const outcomeLabel = (o: Outcome): string => OUTCOME_LABELS[o];

/** "PHASE2" -> "Phase 2", "EARLY_PHASE1" -> "Early phase 1", "NA" or null -> "Not applicable". */
export function phaseLabel(p: string | null): string {
  if (p === null || p === "NA") return "Not applicable";
  if (p === "EARLY_PHASE1") return "Early phase 1";
  const m = /^PHASE(\d)$/.exec(p);
  return m ? `Phase ${m[1]}` : p;
}

/** Plain registry phase list: ["PHASE1", "PHASE2"] -> "Phase 1/2"; ["NA"] -> "No phase"; [] -> "—". */
export function phasesLabel(phases: string[]): string {
  if (phases.length === 0) return DASH;
  if (phases.every((p) => p === "NA")) return "No phase";
  const numbered = phases.map((p) => /^PHASE(\d)$/.exec(p)?.[1]);
  if (phases.length === 2 && numbered[0] && numbered[1]) return `Phase ${numbered[0]}/${numbered[1]}`;
  return phases.map(phaseLabel).join(", ");
}

const STATUS: Record<string, string> = {
  RECRUITING: "Recruiting",
  ACTIVE_NOT_RECRUITING: "Active, not recruiting",
  NOT_YET_RECRUITING: "Not yet recruiting",
  ENROLLING_BY_INVITATION: "Enrolling by invitation",
  COMPLETED: "Completed",
  TERMINATED: "Terminated",
  WITHDRAWN: "Withdrawn",
  SUSPENDED: "Suspended",
  UNKNOWN: "Unknown",
};

/** Registry overall status: "NOT_YET_RECRUITING" -> "Not yet recruiting"; unlisted values fall back to sentence case. */
export function statusLabel(s: string): string {
  if (Object.prototype.hasOwnProperty.call(STATUS, s)) return STATUS[s] as string;
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Registry intervention type in sentence case: "DIETARY_SUPPLEMENT" -> "Dietary supplement". */
export function treatmentLabel(t: string): string {
  const s = t.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The first n sentences; a sentence ends at ". ", "? " or "! " followed by a capital letter. */
export function firstSentences(text: string, n = 2): string {
  return text
    .trim()
    .split(/(?<=[.?!])\s+(?=[A-Z])/)
    .slice(0, n)
    .join(" ");
}

const ageParts = (y: number): [string, "month" | "year"] => {
  if (y < 1) return [String(Math.max(1, Math.round(y * 12))), "month"];
  return [String(Math.round(y * 10) / 10), "year"];
};
const unitText = (n: string, u: string) => `${n} ${u}${n === "1" ? "" : "s"}`;

/** Registry age bounds in natural words: "18–55 years", "18 years and over", "6 months–17 years". */
export function formatAgeRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "";
  if (max === null) {
    const [n, u] = ageParts(min as number);
    return `${unitText(n, u)} and over`;
  }
  const [mx, mu] = ageParts(max);
  if (min === null) return `up to ${unitText(mx, mu)}`;
  const [mn, nu] = ageParts(min);
  if (mn === mx && nu === mu) return unitText(mn, mu);
  return nu === mu ? `${mn}–${unitText(mx, mu)}` : `${unitText(mn, nu)}–${unitText(mx, mu)}`;
}

const SEX: Record<string, string> = { ALL: "All sexes", FEMALE: "Female only", MALE: "Male only" };
export const sexLabel = (s: string): string => SEX[s] ?? s;

/** The plate mark for a registry status: running ring, stopped dot, finished pale dot, unknown dashed. */
export function markState(status: string): MarkState {
  switch (status) {
    case "RECRUITING":
    case "ACTIVE_NOT_RECRUITING":
    case "NOT_YET_RECRUITING":
    case "ENROLLING_BY_INVITATION":
      return "run";
    case "TERMINATED":
    case "WITHDRAWN":
    case "SUSPENDED":
      return "stop";
    case "COMPLETED":
      return "fin";
    default:
      return "unk";
  }
}
