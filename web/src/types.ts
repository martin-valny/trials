/** Mirrors the JSON written by pipeline/src/trialradar/export.py exactly. */

export interface DateInfo {
  date: string; // YYYY-MM-DD
  precision: "day" | "month";
  type: "ACTUAL" | "ESTIMATED" | null;
}

export interface ChangeItem {
  nct_id: string;
  title: string | null;
  lead_sponsor: string | null;
  field: string;
  old_value: unknown;
  new_value: unknown;
  detected_date: string;
  delta_days: number | null;
  notable: boolean;
  notable_reason: string | null;
  source_url: string;
}

export interface ChangesFile {
  window_days: 1 | 7 | 30;
  generated_for: string;
  changes: ChangeItem[];
}

export interface TrialFile {
  nct_id: string;
  title: string;
  phases: string[];
  overall_status: string;
  why_stopped: string | null;
  start_date: DateInfo | null;
  primary_completion_date: DateInfo | null;
  completion_date: DateInfo | null;
  enrollment: number | null;
  enrollment_type: string | null;
  lead_sponsor: string | null;
  sponsor_class: string | null;
  conditions: string[];
  interventions: { type: string; name: string }[];
  countries: string[];
  site_count: number;
  primary_outcomes: { measure: string; time_frame: string | null }[];
  secondary_outcomes: { measure: string; time_frame: string | null }[];
  allocation: string | null;
  masking: string | null;
  last_update_post_date: string | null;
  changes: ChangeItem[];
  source_url: string;
}

export interface Meta {
  area: string;
  conditions: string[];
  generated_for: string;
  trial_count: number;
  last_success_at: string; // ISO, UTC, trailing Z
  data_timestamp: string;
  warnings: string[];
}

export type Window = 1 | 7 | 30;
